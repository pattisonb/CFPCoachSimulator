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

import league as lg
import recruits

STAGES = ("departures", "portal_1", "portal_2", "development", "staff", "ready")
STAGE_NAMES = {"departures": "Departures", "portal_1": "Transfer portal, round 1", "portal_2": "Transfer portal, round 2",
               "development": "Development", "staff": "Staff", "ready": "Ready for next season"}
ROSTER_LIMIT = 85
GROUP = {"QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL", "RT": "OL",
         "LEDG": "DL", "REDG": "DL", "DT": "DL", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "CB": "CB", "FS": "S", "SS": "S",
         "K": "K", "P": "P"}
# a healthy roster's players per group (the real 2026 FBS mean) and the floor walk-ons top up to
TARGET = {"QB": 4, "RB": 6, "WR": 10, "TE": 6, "OL": 15, "DL": 15, "LB": 9, "CB": 8, "S": 8, "K": 2, "P": 2}
FLOOR = {"QB": 3, "RB": 3, "WR": 6, "TE": 3, "OL": 10, "DL": 9, "LB": 5, "CB": 5, "S": 4, "K": 1, "P": 1}
ENGINE_POS = {"QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "OL": "OL", "DL": "DL", "LB": "MLB", "CB": "CB", "S": "S", "K": "K", "P": "P"}

# ----- departures *tune* -----
NEXT_CLASS = {"FR": "SO", "FRRS": "SORS", "SO": "JR", "SORS": "JRRS", "JR": "SR", "JRRS": "SRRS"}
REDSHIRT = {"FR": 0.62, "SO": 0.22, "JR": 0.16}   # chance a player off the depth chart's top takes his redshirt year
FIFTH_YEAR = 0.30                                  # a senior with his redshirt unused who barely played comes back
DRAFT_PICKS = 257
DRAFT_FROM_FBS = 0.97                              # the share of picks from FBS (the rest from lower levels)
# position value in the draft, in house-scale points over his card overall
POSITION_VALUE = {"QB": 6, "LT": 4, "RT": 3, "LEDG": 4, "REDG": 4, "CB": 3, "WR": 2, "DT": 1, "LG": -1, "RG": -1, "C": -2,
                  "TE": -1, "HB": -3, "FB": -12, "SAM": 0, "MIKE": -1, "WILL": -1, "FS": 0, "SS": -1, "K": -18, "P": -20}
DRAFT_NOISE = 4.0
DECLARE = ((32, 0.92), (64, 0.75), (100, 0.45), (160, 0.15), (257, 0.05), (10**9, 0.003))   # projected pick -> an underclassman declares
UNDERCLASS_ELIGIBLE = {"JR", "JRRS", "SORS"}       # three years out of high school
PORTAL_BASE = {"FR": 0.09, "FRRS": 0.17, "SO": 0.19, "SORS": 0.24, "JR": 0.18, "JRRS": 0.22, "SR": 0.33}
PORTAL_USAGE = {"starter": 0.12, "rotation": 0.65, "bench": 1.3}
PORTAL_LOSING = 1.25                               # a losing season pushes players out
QUIT = 0.012                                       # quitting or a medical retirement, a year
QUIT_LOW = 2.5                                     # ... this much likelier in the team's bottom 15%

# ----- the portal *tune* -----
PORTAL_OFFER_FACTOR = 1.5                          # a school's offers a round, times its open spots
OPEN_TAKE_ANY = 6                                  # with this many open spots a school takes good players at any position
PT_WEIGHT, PRESTIGE_WEIGHT, WIN_WEIGHT, HOME_WEIGHT, PICK_NOISE = 2.0, 1.0, 0.6, 0.4, 0.5

# ----- development and staff *tune* -----
COORD_SHARE = 0.4                                  # the coordinator's part of a player's coach factor
HC_RETIRE = 0.04                                   # a head coach retires, a year (more after a long tenure)
HC_FIRE_BELOW = 0.40                               # a Power 4 coach under this over three years may be fired
HC_FIRE = 0.55
COORD_TURNOVER = 0.15
STAFF_POACH = 0.35                                 # your coordinator hired away after a big year, at 90
RECRUITER_LEAVE = 0.12


def _rng(state: dict, what: str) -> random.Random:
    return random.Random(f"offseason-{state['id']}-{state.get('year', 2026)}-{what}")


def _attrs(lgd: dict) -> list[str]:
    return lgd["attrs"]


def house(pos: str, ea_overall: float) -> int:
    import season
    import build_teams
    return season.ea_house(build_teams.POSITION_MAP.get(pos, pos), ea_overall)


def _record(state: dict, slug: str) -> tuple[int, int]:
    import season
    r = season._records(state, include_playoff=True).get(slug) or {}
    return r.get("wins", 0), r.get("losses", 0)


def _usage() -> dict[str, dict[str, str]]:
    """team -> player slug -> starter / rotation (next on his role's depth) / bench, from the season's teams."""
    import season
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
    import season
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
                          "signed": signed, "staff": None, "report": None}
    return state["offseason"]


def _departures(state: dict, lgd: dict, usage: dict) -> tuple[list[dict], dict]:
    rng = _rng(state, "departures")
    attrs = _attrs(lgd)
    events, entrants = [], {}
    records = {slug: _record(state, slug) for slug in lgd["teams"]}
    # the draft: seniors and the underclassmen who declare, ranked by draft score
    pool = []
    for slug, t in lgd["teams"].items():
        for p in t["roster"]:
            if p["cls"] in ("SR", "SRRS") or p["cls"] in UNDERCLASS_ELIGIBLE:
                score = house(p["pos"], p["o"]) + POSITION_VALUE.get(p["pos"], 0) + rng.gauss(0, DRAFT_NOISE)
                pool.append((score, slug, p))
    pool.sort(key=lambda x: -x[0])
    fbs_picks = round(DRAFT_PICKS * DRAFT_FROM_FBS)
    declared = set()
    for i, (score, slug, p) in enumerate(pool, 1):
        if p["cls"] in UNDERCLASS_ELIGIBLE:
            chance = next(c for cut, c in DECLARE if i <= cut)
            if rng.random() < chance:
                declared.add(p["id"])
    board = [(score, slug, p) for score, slug, p in pool if p["cls"] in ("SR", "SRRS") or p["id"] in declared]
    drafted = {}
    for pick, (score, slug, p) in enumerate(board[:fbs_picks], 1):
        drafted[p["id"]] = pick
    leaving: dict[str, set] = {slug: set() for slug in lgd["teams"]}
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
                    if rng.random() < chance:
                        ev.update(kind="portal")
                        q = dict(p, cls=nxt, yrs=0)
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


def _next_class(p: dict, use: str, rng: random.Random) -> str:
    """Next year's class: a player who did not play much may take his redshirt (once)."""
    cls = p["cls"]
    if not cls.endswith("RS") and use != "starter":
        chance = REDSHIRT.get(cls, 0.0) * (0.35 if use == "rotation" else 1.0)
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
    import recruiting
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
        p = rc["prospects"][pid]
        team = lgd["teams"][slug]
        src = {"slug": pid, "name": p["name"], "position": p["ea_position"], "class": "FR", "height": p["height"],
               "weight_lbs": p["weight"], "archetype": p["archetype"], "dev_trait": "Normal",
               "ratings_ea": recruiting.attributes(state, p, "ratings_ea"), "potential_ea": recruiting.attributes(state, p),
               "coachability": p["coachability"], "stars": p["stars"], "hometown": p["hometown"]}
        c = lg.compact(src, attrs)
        c["j"] = _jersey(team["roster"], c["pos"], rng)
        c["signed"] = True
        team["roster"].append(c)
        out[slug] = out.get(slug, 0) + 1
    return out


# ----- the transfer portal ----------------------------------------------------------------------

def open_spots(lgd: dict, slug: str, portal: dict) -> int:
    taken = sum(1 for e in portal["players"].values() if e["signed"] == slug)
    return max(0, ROSTER_LIMIT - len(lgd["teams"][slug]["roster"]) - taken)


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
    import season
    t = season.load_teams().get(slug) or {}
    return ((t.get("team_ratings") or {}).get("overall", 70) - 70) / 15


def entrant_interest(state: dict, lgd: dict, slug: str, e: dict, rng: Optional[random.Random] = None) -> float:
    p = e["player"]
    wins, losses = _record(state, slug)
    home = 1.0 if lg.base_team(slug).get("state") == p.get("home") else 0.0
    noise = rng.gauss(0, PICK_NOISE) if rng else 0.0
    return (PT_WEIGHT * playing_time(lgd, slug, p) + PRESTIGE_WEIGHT * _prestige(slug)
            + WIN_WEIGHT * wins / max(1, wins + losses) + HOME_WEIGHT * home + noise)


def ai_offers(state: dict, slug: str) -> list[str]:
    """A school's portal offers this round: by need (groups short of a healthy depth first), the
    best entrants who would play there, up to PORTAL_OFFER_FACTOR times its open spots."""
    off = state["offseason"]
    lgd, portal = state["league"], off["portal"]
    spots = open_spots(lgd, slug, portal)
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
        if need[g] <= 0 and spots < OPEN_TAKE_ANY:
            continue
        vals = depth[g]
        bar = vals[min(len(vals) - 1, STARTERS[g] + 2)] if vals else 0      # about as good as his fourth-stringer
        if p["o"] < bar - 3:
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
    offers: dict[str, list[str]] = {}
    mine = set(portal["offers"].get(me, []))
    if (state.get("career") or {}).get("settings", {}).get("auto_recruit") not in (None, False, "off") and not mine:
        mine = set(ai_offers(state, me))
    for pid in mine:
        offers.setdefault(pid, []).append(me)
    for slug in lgd["teams"]:
        if slug == me:
            continue
        for pid in ai_offers(state, slug):
            offers.setdefault(pid, []).append(slug)
    moves = []
    spots = {slug: open_spots(lgd, slug, portal) for slug in lgd["teams"]}
    for pid in sorted(offers, key=lambda q: -portal["players"][q]["player"]["o"]):
        e = portal["players"][pid]
        if e["signed"]:
            continue
        e["offers"] = sorted(set(e["offers"]) | set(offers[pid]))
        choices = [s for s in offers[pid] if spots.get(s, 0) > 0]
        if not choices:
            continue
        pick = max(choices, key=lambda s: entrant_interest(state, lgd, s, e, rng))
        e["signed"] = pick
        spots[pick] -= 1
        moves.append({"id": pid, "name": e["player"]["n"], "pos": e["player"]["pos"], "from": e["from"], "to": pick,
                      "overall": house(e["player"]["pos"], e["player"]["o"]), "round": portal["round"]})
    portal["moves"] += moves
    portal["offers"] = {}
    return moves


def _close_portal(state: dict) -> None:
    """Signed transfers join their new rosters; the rest leave FBS."""
    lgd, portal = state["league"], state["offseason"]["portal"]
    rng = _rng(state, "portal-jerseys")
    for pid, e in portal["players"].items():
        if e["signed"]:
            p = dict(e["player"])
            team = lgd["teams"][e["signed"]]
            p["j"] = _jersey(team["roster"], p["pos"], rng)
            p["transfer"] = e["from"]
            team["roster"].append(p)


# ----- development ------------------------------------------------------------------------------

def coach_factor(coaches: dict, pos: str) -> float:
    """His coaches' factor on development: the head coach's player development with the
    coordinator on his side of the ball; about 0.8 at 30, 1.0 at 50, 1.2 at 90."""
    hc = (coaches.get("head_coach") or {}).get("ratings", {}).get("player_development", 50)
    side = "offensive_coordinator" if pos in lg.OFFENSE_ROLES else "defensive_coordinator" if GROUP[pos] not in ("K", "P") else "head_coach"
    co = (coaches.get(side) or {}).get("ratings", {}).get("player_development", hc)
    r = (1 - COORD_SHARE) * hc + COORD_SHARE * co
    return 1 + (r - 50) / 200 if r >= 50 else 1 + (r - 50) / 100


def develop(p: dict, attrs: list[str], factor: float, rng: random.Random) -> int:
    """One offseason's growth (recruits.develop on the league's form); returns the EA overall gained."""
    rate = recruits.RATE.get(p.get("c"), 0.27) * factor
    before = dict(zip(attrs, p["r"]))
    new_r, new_g = [], []
    for v, g in zip(p["r"], p["g"]):
        step = int(round(min(g, g * rate * rng.uniform(0.8, 1.2)))) if g > 0 else 0
        new_r.append(min(99, v + step))
        new_g.append(g - step)
    fit0 = recruits.overall_ea(p["pos"], p["a"], before)
    p["r"], p["g"] = new_r, new_g
    fit1 = recruits.overall_ea(p["pos"], p["a"], dict(zip(attrs, new_r)))
    gain = int(round(fit1 - fit0))
    p["o"] = int(max(1, min(99, p["o"] + gain)))
    return gain


def _develop_all(state: dict) -> dict:
    """Everyone back from last season develops; transfers too; this year's signees arrive as they are."""
    lgd = state["league"]
    rng = _rng(state, "develop")
    attrs = _attrs(lgd)
    gains, mine = [], []
    for slug, t in lgd["teams"].items():
        for p in t["roster"]:
            if p.pop("signed", False):
                continue
            g = develop(p, attrs, coach_factor(t["coaches"], p["pos"]), rng)
            p["yrs"] = p.get("yrs", 0) + 1
            gains.append(g)
            if slug == state["team"]:
                mine.append({"id": p["id"], "name": p["n"], "pos": p["pos"], "cls": p["cls"], "gain": house(p["pos"], p["o"]) - house(p["pos"], p["o"] - g),
                             "overall": house(p["pos"], p["o"])})
    mine.sort(key=lambda r: -r["gain"])
    return {"mean_gain_ea": round(st.mean(gains), 2) if gains else 0.0, "mine": mine}


def _fill_rosters(state: dict) -> dict:
    """Walk-ons where a group has fallen below its floor and then up to the roster limit (the
    thinnest groups first, against a healthy roster's make-up); rosters over the limit release
    their lowest-rated non-seniors (counted as quitting)."""
    lgd = state["league"]
    rng = _rng(state, "walk-ons")
    attrs = _attrs(lgd)
    added = released = 0
    walk_ons: dict[str, list] = {}
    taken: set = set()
    for slug, t in lgd["teams"].items():
        counts = _group_counts(t["roster"])
        wanted = [g for g, floor in FLOOR.items() for _ in range(max(0, floor - counts[g]))]
        size = len(t["roster"]) + len(wanted)
        short = dict(counts)
        for g in wanted:
            short[g] += 1
        while size < ROSTER_LIMIT:
            g = max(TARGET, key=lambda k: (TARGET[k] - short[k]) / TARGET[k])
            wanted.append(g)
            short[g] += 1
            size += 1
        for g in wanted:
            pool = walk_ons.setdefault(g, [])
            while not pool:
                r = recruits.recruit(rng, state["offseason"]["year"], "2", taken)
                walk_ons.setdefault(GROUP.get(r["ea_position"], "S"), []).append(r)
            r = pool.pop()
            src = recruits.as_roster_player(r, lg.base_team(slug), f"w{state['offseason']['year']}-{slug}-{added}")
            c = lg.compact(src, attrs)
            c["j"] = _jersey(t["roster"], c["pos"], rng)
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


def _carousel(state: dict) -> list[dict]:
    """AI programs: head coaches retire or are fired after a bad run; coordinators turn over."""
    import season
    lgd = state["league"]
    rng = _rng(state, "carousel")
    year = state["offseason"]["year"]
    hist = (state.get("career") or {}).get("league_records", {})
    changes = []
    me = state["team"]
    for slug, t in lgd["teams"].items():
        if slug == me:
            continue
        hc = t["coaches"]["head_coach"]
        tenure = year - (hc.get("since") or 2020)
        recs = hist.get(slug, [])[-3:]
        pct = sum(w for w, l in recs) / max(1, sum(w + l for w, l in recs)) if recs else 0.5
        p4 = season._is_p4(slug, season.load_teams()[slug])
        reason = None
        if len(recs) >= 3 and pct < (HC_FIRE_BELOW if p4 else HC_FIRE_BELOW - 0.1) and rng.random() < HC_FIRE:
            reason = "fired"
        elif rng.random() < HC_RETIRE * (1 + max(0, tenure - 10) / 10):
            reason = "retired"
        if reason:
            old = hc["name"]
            t["coaches"]["head_coach"] = _new_coach(lgd, "head_coach", slug, year, rng, like=None if reason == "fired" else hc)
            t["observed"] = False
            changes.append({"team": slug, "role": "head_coach", "old": old, "new": t["coaches"]["head_coach"]["name"], "reason": reason})
        for role in ("offensive_coordinator", "defensive_coordinator"):
            if rng.random() < COORD_TURNOVER:
                old = (t["coaches"].get(role) or {}).get("name")
                t["coaches"][role] = _new_coach(lgd, role, slug, year, rng, like=t["coaches"].get(role))
                changes.append({"team": slug, "role": role, "old": old, "new": t["coaches"][role]["name"], "reason": "moved on"})
    return changes


def _staff_changes(state: dict) -> dict:
    """Your staff: a coordinator may be hired away after a winning year (likelier the better he
    is), a recruiter moves on now and then; each opening gets three candidates."""
    import recruiting
    rng = _rng(state, "staff")
    staff = state["career"]["staff"]
    wins, losses = _record(state, state["team"])
    pct = wins / max(1, wins + losses)
    leaving, candidates = [], {}
    taken = {s["name"] for s in staff}
    for s in staff:
        if s["role"] in ("OC", "DC"):
            chance = STAFF_POACH * max(0.0, (pct - 0.55) / 0.45) * (s["evaluation"] / 90) ** 2
        else:
            chance = RECRUITER_LEAVE
        if rng.random() < chance:
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


# ----- walking the stages -----------------------------------------------------------------------

def advance(state: dict) -> dict:
    """Finish the current stage and open the next one."""
    off = state["offseason"]
    stage = off["stage"]
    if stage == "departures":
        off["stage"] = "portal_1"
    elif stage == "portal_1":
        resolve_round(state)
        off["portal"]["round"] = 2
        off["stage"] = "portal_2"
    elif stage == "portal_2":
        resolve_round(state)
        _close_portal(state)
        off["report"] = {"development": _develop_all(state), **_fill_rosters(state)}
        off["stage"] = "development"
    elif stage == "development":
        off["staff"] = _staff_changes(state)
        off["coaching_changes"] = _carousel(state)
        off["stage"] = "staff"
    elif stage == "staff":
        off["staff"]["changes"] = _apply_staff(state)
        off["stage"] = "ready"
    return off


def run_all(state: dict) -> None:
    """Every remaining stage on Auto."""
    start(state)
    while state["offseason"]["stage"] != "ready":
        advance(state)


# ----- the next season --------------------------------------------------------------------------

def summary(state: dict) -> dict:
    """The season just finished, for the career's history."""
    import season
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
        import prospects
        out["class_rank"] = prospects.class_rank(state, me)
        out["signed"] = sum(1 for s in rc["status"].values() if s.get("signed") == me)
    off = state.get("offseason") or {}
    out["drafted"] = sum(1 for d in off.get("departures", []) if d["team"] == me and d.get("kind") == "draft")
    return out


def next_season(state: dict) -> dict:
    """The next season's state for this career: same id, the league as the offseason left it,
    the career (staff, settings, history) carried over, a new class of high school seniors."""
    import career as career_mod
    import recruiting
    import season
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
    new = season.new_season(state["team"], "full", seed=_rng(state, "seed").randrange(1 << 30), coach=state.get("coach"), year=year)
    new.update(id=state["id"], created_at=state["created_at"], league=lgd, settings=state.get("settings", new["settings"]))
    car = state["career"]
    car["year"] = year
    car["saved_week"] = 0
    car["saved_at"] = career_mod._now()
    settings = car.setdefault("settings", {})
    if settings.get("auto_recruit") == "week":
        settings["auto_recruit"] = "off"
    new["career"] = car
    recruiting.start(new, year=year + 1)
    import prospects
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
            if len(mine) >= max(1, math.ceil(PORTAL_OFFER_FACTOR * open_spots(state["league"], me, off["portal"]))):
                raise OverflowError("no offers left this round")
            mine.append(pid)
    elif pid in mine:
        mine.remove(pid)
    return mine


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
    my_moves = [m for m in portal["moves"] if m["to"] == me or m["from"] == me]
    staff = off.get("staff")
    out = {
        "stage": off["stage"], "stage_name": STAGE_NAMES[off["stage"]], "year": off["year"],
        "stages": [{"key": s, "name": STAGE_NAMES[s], "done": STAGES.index(s) < STAGES.index(off["stage"]),
                    "current": s == off["stage"]} for s in STAGES],
        "departures": {"mine": [dict(d, kind_name=KIND_NAMES[d["kind"]]) for d in deps if d["team"] == me],
                       "league": kinds, "first_round": [d for d in sorted((d for d in deps if d["kind"] == "draft"), key=lambda d: d["pick"])][:32],
                       "early_entrants": sum(1 for d in deps if d.get("early"))},
        "signed": off.get("signed", {}).get(me, 0),
        "roster": len(lgd["teams"][me]["roster"]),
        "open_spots": open_spots(lgd, me, portal),
        "portal": {"round": portal["round"], "entrants": len(portal["players"]),
                   "signed": sum(1 for e in portal["players"].values() if e["signed"]),
                   "offers": list(portal["offers"].get(me, [])),
                   "offers_left": max(0, math.ceil(PORTAL_OFFER_FACTOR * open_spots(lgd, me, portal)) - len(portal["offers"].get(me, []))),
                   "moves_mine": my_moves,
                   "rows": portal_rows(state, position, status) if off["stage"] in ("portal_1", "portal_2", "development") else []},
        "report": off.get("report") and {"mine": off["report"]["development"]["mine"][:25],
                                         "mean_gain_ea": off["report"]["development"]["mean_gain_ea"],
                                         "walk_ons": off["report"]["walk_ons"]},
        "staff": None,
        "coaching_changes": [c for c in off.get("coaching_changes", []) if c["role"] == "head_coach"],
        "history": (state.get("career") or {}).get("history", []),
    }
    if staff:
        by_id = {s["id"]: s for s in state["career"]["staff"]}
        out["staff"] = {"leaving": [by_id[i] for i in staff["leaving"] if i in by_id], "candidates": staff["candidates"],
                        "hired": staff["hired"], "changes": staff.get("changes", [])}
    return out
