"""Coach Career Prospect Profiles (docs/superpowers/specs/2026-10-22-coach-career-design.md,
section 6): a prospect's public page (the national rankings' read of him, with its own error), a
written evaluation for the top 300, comps only to real starters and only when close, and your
staff's grades and comp once they have seen enough of him.

A comp compares the prospect's projected ceiling (his potential ratings) with a starter's
ratings over the attributes that matter most at his EA position."""
from __future__ import annotations

import json
import math
import random
import statistics
from functools import lru_cache
from pathlib import Path
from typing import Optional

from coach_career import recruiting

ROOT = Path(__file__).resolve().parents[1]   # the project root
SOURCE_TEAMS = ROOT / "cfb_sim_data" / "teams"
EVALUATED = 300                    # the top 300 get a written evaluation and a public comp
COMP_PERCENTILE = 0.50             # COMP_MAX_DISTANCE: this percentile of starter-to-starter distances *tune*
COMP_ATTRIBUTES = 10               # the attributes compared: those that track a starter's overall most at the position
OUR_COMP_LOOKS = 3                 # looks before your staff offer their own comp
READ_SHIFT = 0.5                   # rating points an attribute moves per grade point a read is off *tune*
PUBLIC_SD = 3.0                    # the national rankings' error on his grades, in grade points *tune*
EVAL_GROUPS = ("athleticism", "size_strength", "technique", "football_iq", "potential")
GROUP_NAMES = {"athleticism": "athleticism", "size_strength": "size and strength", "technique": "technique",
               "football_iq": "football IQ", "potential": "upside", "coachability": "coachability"}
STRENGTH_TEXT = {
    "athleticism": "Rare athleticism for a {pos}: burst, change of direction and speed to separate.",
    "size_strength": "Size and strength already at a college level; wins with power.",
    "technique": "Polished technique; plays like a coached, refined {pos}.",
    "football_iq": "High football IQ: reads it fast and is rarely out of position.",
    "potential": "Big upside: the frame and tools to keep climbing for years.",
}
WEAKNESS_TEXT = {
    "athleticism": "Athleticism is only average for the position; may lack a top gear.",
    "size_strength": "Needs to add strength and fill out his frame.",
    "technique": "Technique is raw and will need refinement.",
    "football_iq": "Still learning the game; processing can be slow.",
    "potential": "Closer to his ceiling than most at this stage.",
}
STRENGTH_FROM, WEAKNESS_BELOW = 60, 45        # the game's scale: a B and up reads as a strength, below a C as a weakness
SOLID_TEXT = "Solid for a {pos} at this level; not a concern."
OUTLOOK = {
    5: "Day-one impact {pos} with early-round NFL upside.",
    4: "Projects as a multi-year starter at a Power 4 program.",
    3: "A developmental {pos} who could start by his third year.",
    2: "A depth {pos} with a path to the field through special teams and development.",
}
SCHOOL_KINDS = ("High School", "High School", "High School", "Central", "North", "South", "Catholic", "Prep", "Academy")


# ----- comps ---------------------------------------------------------------------------------------

@lru_cache(maxsize=1)
def starter_pool() -> tuple[dict, ...]:
    """Today's starters in the league in play, with their skills on our scale and our overall."""
    from teamdata import game_scale
    from sim import season
    keys = game_scale.keys()
    out = []
    for slug, t in season.load_teams().items():
        if t.get("fictional"):
            continue
        for p in t["offense"] + t["defense"]:
            if p.get("in_game") and p.get("skills") and p.get("role"):
                out.append({"name": p["name"], "slug": p["slug"], "school": t.get("school") or t["name"], "team": slug,
                            "position": p["role"], "skills": dict(zip(keys, p["skills"])), "overall": p.get("ovr")})
    return tuple(out)


@lru_cache(maxsize=None)
def _attributes(position: str) -> tuple[str, ...]:
    """The skills compared at a position: those that track a starter's overall most there."""
    starters = [s for s in starter_pool() if s["position"] == position and s.get("overall") is not None]
    if len(starters) < 3:
        return ()
    overall = [s["overall"] for s in starters]

    def corr(k: str) -> float:
        try:
            return statistics.correlation([s["skills"].get(k, 0) for s in starters], overall)
        except statistics.StatisticsError:      # a skill every starter shares
            return 0.0
    return tuple(sorted(starters[0]["skills"], key=lambda k: -corr(k))[:COMP_ATTRIBUTES])


def _distance(a: dict, b: dict, keys: tuple[str, ...]) -> float:
    return math.sqrt(sum((a.get(k, 0) - b.get(k, 0)) ** 2 for k in keys) / len(keys))


@lru_cache(maxsize=None)
def comp_max_distance(position: str) -> float:
    """COMP_MAX_DISTANCE at a position: the 30th percentile of distances between its starters."""
    starters = [s for s in starter_pool() if s["position"] == position]
    keys = _attributes(position)
    d = sorted(_distance(a["skills"], b["skills"], keys)
               for i, a in enumerate(starters) for b in starters[i + 1:])
    return d[int(COMP_PERCENTILE * (len(d) - 1))] if d else 0.0


def warm() -> None:
    """Load the starters and each position's comp distance ahead of the first profile."""
    for position in {s["position"] for s in starter_pool()}:
        comp_max_distance(position)


def ceiling(state: dict, p: dict) -> dict:
    """A prospect's projected skills (his potential, our scale): what a comp is measured on."""
    return recruiting.attributes(state, p, "potential")


def comp(profile_vector: dict, position: str, pool) -> Optional[dict]:
    """The nearest starter at the same position, or None when nobody is close enough."""
    keys = _attributes(position)
    if not keys:
        return None
    best = min((s for s in pool if s["position"] == position), key=lambda s: _distance(profile_vector, s["skills"], keys),
               default=None)
    if best is None or _distance(profile_vector, best["skills"], keys) > comp_max_distance(position):
        return None
    out = {k: best[k] for k in ("name", "slug", "school", "team", "position")}
    out["overall"] = best.get("overall")
    return out


def _shifted(state: dict, p: dict, grades: dict[str, float]) -> dict:
    """His ceiling as a read sees it: each group's attributes moved by how far the read is off
    his true grade (grade points to rating points)."""
    groups = {"athleticism": recruiting._ATHLETIC, "size_strength": recruiting._SIZE, "football_iq": recruiting._IQ}
    out = {}
    for k, v in ceiling(state, p).items():
        g = next((g for g, keys in groups.items() if k in keys), "technique")
        off = READ_SHIFT * (grades[g] - p["truth"][g]) + READ_SHIFT / 2 * (grades["potential"] - p["truth"]["potential"])
        out[k] = max(0, min(99, v + off))
    return out


# ----- the profile ---------------------------------------------------------------------------------

def _public_grades(p: dict) -> dict[str, float]:
    rng = random.Random(f"public-{p['id']}")
    return {g: p["truth"][g] + rng.gauss(0, PUBLIC_SD) for g in recruiting.GROUPS}


def _ranks(state: dict) -> dict[str, tuple[int, int]]:
    """(position rank, state rank) for every prospect."""
    global _RANKS
    rc = state["recruiting"]
    key = (state["id"], rc["year"])
    cached = _RANKS                       # one read: another request may swap it in meanwhile
    if cached[0] == key:
        return cached[1]
    pos, home, out = {}, {}, {}
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        pos[p["position"]] = pos.get(p["position"], 0) + 1
        home[p["hometown"]["state"]] = home.get(p["hometown"]["state"], 0) + 1
        out[pid] = (pos[p["position"]], home[p["hometown"]["state"]])
    _RANKS = (key, out)
    return out


_RANKS: tuple = (None, {})


DETAIL_PEERS = 8                   # prospects at his position needed to describe a grade from them alone


def grade_detail(state: dict, p: dict, group: str, lo: float, hi: float) -> dict:
    """What a grade range looks like in ratings: the middle half of the EA ratings of this class's
    prospects whose true grade falls in the range (at his position when there are enough).
    Coachability is described by its labels instead."""
    rc = state["recruiting"]
    lo, hi = max(recruiting.GRADE_LOW, lo), min(recruiting.GRADE_LOW + recruiting.GRADE_SPAN, hi)
    if group == "coachability":
        labels = [name for name, pts in recruiting.COACHABILITY_POINTS.items() if lo - 5 <= pts <= hi + 5]
        return {"labels": labels or [min(recruiting.COACHABILITY_POINTS, key=lambda n: abs(recruiting.COACHABILITY_POINTS[n] - (lo + hi) / 2))],
                "ratings": {}}
    peers = [q for q in rc["prospects"].values() if lo <= q["truth"][group] <= hi]
    same = [q for q in peers if q["ea_position"] == p["ea_position"]]
    peers = same if len(same) >= DETAIL_PEERS else peers
    if len(peers) < 4:                         # a narrow read: the nearest prospects instead
        mid = (lo + hi) / 2
        peers = sorted(rc["prospects"].values(), key=lambda q: abs(q["truth"][group] - mid))[:30]
    from teamdata import ratings as rv2
    from sim import season
    if group == "potential":
        from coach_career import recruits
        vals = [q["pot_ovr"] for q in peers]
        mid = _middle(vals)
        pos = engine_position(p)
        return {"ratings": {"Projected overall": mid}, "peers": len(peers),
                "league": {"Projected overall": league_rank(pos, "overall", (mid[0] + mid[1]) / 2)}}
    keys = group_keys(p, group)
    cards = [game_attributes(state, q) for q in peers]
    ratings = {k: _middle([c[k] for c in cards if k in c]) for k in keys if any(k in c for c in cards)}
    pos = engine_position(p)
    return {"ratings": {rv2.ATTRIBUTES[k][0]: v for k, v in ratings.items()}, "peers": len(peers),
            "league": {rv2.ATTRIBUTES[k][0]: league_rank(pos, k, (v[0] + v[1]) / 2) for k, v in ratings.items()}}


_LEAGUE: dict = {}


def reset_caches() -> None:
    """Forget everything worked out from the league's rosters (season.use_league switched it)."""
    global _RANKS
    _LEAGUE.clear()
    _RANKS = (None, {})
    starter_pool.cache_clear()
    _attributes.cache_clear()
    comp_max_distance.cache_clear()


def league_values(pos: str, key: str) -> tuple[list, list]:
    """Today's FBS players at a position (linebackers together): their card values of `key`
    (an attribute, or 'overall'), all of them and the starters, highest first."""
    from sim import season
    group = season.SCALE_GROUP.get(pos, pos)
    if (group, key) not in _LEAGUE:
        allv, starters = [], []
        for slug, t in season.load_teams().items():
            if t.get("fictional") or t.get("subdivision") == "FCS":
                continue
            for q in t["offense"] + t["defense"]:
                if season.SCALE_GROUP.get(q["position"], q["position"]) != group:
                    continue
                v = season.shown_overall(q) if key == "overall" else (q.get("attributes") or {}).get(key)
                if v is None:
                    continue
                allv.append(v)
                if q.get("in_game"):
                    starters.append(v)
        _LEAGUE[(group, key)] = (sorted(allv, reverse=True), sorted(starters, reverse=True))
    return _LEAGUE[(group, key)]


def league_rank(pos: str, key: str, value: float) -> dict:
    """Where a value would rank among today's players at the position: {rank, of, starter_rank, starters}."""
    allv, starters = league_values(pos, key)
    return {"rank": 1 + sum(1 for v in allv if v > value), "of": len(allv),
            "starter_rank": 1 + sum(1 for v in starters if v > value), "starters": len(starters), "group": pos}


# the player card's attributes each grade is read from (technique: the position's skills)
GAME_GROUPS = {"athleticism": ("top_speed", "burst", "agility", "leaping"), "size_strength": ("strength", "stamina", "durability"),
               "football_iq": ("football_iq",)}


def engine_position(p: dict) -> str:
    from teamdata import build_teams
    return build_teams.POSITION_MAP.get(p["ea_position"], p["position"])


def group_keys(p: dict, group: str) -> tuple:
    """The player-card attributes a grade is the average of: GAME_GROUPS, technique his
    position's skills (a kicker's leg), athleticism a specialist's physical ones he has."""
    from teamdata import ratings as rv2
    from sim import season
    pos = engine_position(p)
    card = rv2.POSITION_ATTRIBUTES.get(season.SCALE_GROUP.get(pos, pos), [])
    if group == "technique":
        return tuple(k for k in card if rv2.ATTRIBUTES[k][1] != "Physical" and k != "return_skill")[:4]
    keys = tuple(k for k in GAME_GROUPS[group] if k in card)
    return keys or tuple(k for k in card if rv2.ATTRIBUTES[k][1] == "Physical" and k != "football_iq")


def game_attributes(state: dict, p: dict, field: str = "ratings") -> dict[str, int]:
    """A prospect's attributes on the game's scale (his EA ratings, or potential with
    field="potential")."""
    return card_attributes(recruiting.attributes(state, p, field), p)


def card_attributes(ours: dict, p: dict) -> dict[str, int]:
    """A prospect's player card attributes from his skills (our scale), exactly as a player's card
    gets them (build_teams): the skills back through the frozen scale, the card's composites, then
    the card scale (50 at the middle Power 4 starter at his position)."""
    from teamdata import game_scale
    from teamdata import ratings as rv2
    pos = engine_position(p)
    raw = rv2.raw_attributes(game_scale.base_from_ours(ours, p.get("ea_position") or pos), pos, pos)
    group = rv2.card_group(pos, pos)
    group = "RB" if group == "FB" else group
    scale = game_scale.card_scale()
    out = {}
    for k, v in raw.items():
        m, hi, lo = scale.get(f"{group}|{k}", (v, 1.5, 0.9))
        out[k] = int(round(max(1, min(99, 50 + (v - m) * (hi if v >= m else lo)))))
    return out


def _middle(vals: list) -> list[int]:
    """The middle half of some ratings, as [low, high]."""
    vals = sorted(vals)
    pick = lambda f: vals[min(len(vals) - 1, int(f * (len(vals) - 1) + 0.5))]
    return [int(round(max(0, min(99, pick(0.25))))), int(round(max(0, min(99, pick(0.75)))))]


def _high_school(p: dict) -> str:
    kind = random.Random(f"school-{p['id']}").choice(SCHOOL_KINDS)
    return f"{p['hometown']['city']} {kind}"


def _schools(state: dict, pid: str) -> list[dict]:
    """His list: the ten schools he likes most among those recruiting him, the leader first."""
    from sim import season
    rc = state["recruiting"]
    teams = season.load_teams()
    offers = {s for s, pids in rc["offers"].items() if pid in pids}
    schools = offers | set(rc["lists"][pid])
    rows = sorted(((recruiting.interest(state, s, pid), s) for s in schools), reverse=True)[:10]
    visits = rc["visits"].get(pid, {})
    pct = {o["school"]: o for o in odds(state, pid)["schools"]}
    return [{"school": s, "name": teams[s]["name"], "interest": round(v, 1), "offered": s in offers,
             "visit": visits.get(s), "pct": round(pct[s]["pct"], 3) if s in pct else None} for v, s in rows]


def _evaluation(p: dict, public: dict[str, float]) -> dict:
    """His three best and two weakest groups, written up: a strength only from a B up, a weakness
    only below a C; anything between is "solid" (a five-star's lowest grade is often still good)."""
    pos = p["ea_position"]
    order = sorted(EVAL_GROUPS, key=lambda g: -public[g])
    head = lambda g: GROUP_NAMES[g][0].upper() + GROUP_NAMES[g][1:]
    strengths, solid, weaknesses = [], [], []
    for g in order[:3]:
        (strengths if public[g] >= STRENGTH_FROM else solid).append(f"{head(g)}: " + (STRENGTH_TEXT[g] if public[g] >= STRENGTH_FROM else SOLID_TEXT).format(pos=pos))
    for g in order[-2:]:
        (weaknesses if public[g] < WEAKNESS_BELOW else solid).append(f"{head(g)}: " + (WEAKNESS_TEXT[g] if public[g] < WEAKNESS_BELOW else SOLID_TEXT).format(pos=pos))
    return {"strengths": strengths, "solid": solid, "weaknesses": weaknesses, "outlook": OUTLOOK.get(p["stars"], OUTLOOK[2]).format(pos=pos)}


def profile(state: dict, pid: str, viewer: str) -> dict:
    """The Prospect Profile as `viewer` (your school) sees it. Never carries the true grades."""
    rc = state["recruiting"]
    p = rc["prospects"].get(pid)
    if p is None or pid not in recruiting.visible(state):
        raise recruiting.RecruitingError(404, "unknown prospect")
    pos_rank, state_rank = _ranks(state)[pid]
    status = rc["status"][pid]
    top = p["rank"] <= EVALUATED
    public_grades = _public_grades(p)
    public = {
        "id": pid, "name": p["name"], "avatar_seed": pid, "hometown": {"city": p["hometown"]["city"], "state": p["hometown"]["state"]},
        "high_school": _high_school(p), "height": p["height"], "weight": p["weight"], "position": p["position"],
        "ea_position": p["ea_position"], "archetype": p["archetype"], "stars": p["stars"], "composite": p["composite"],
        "national_rank": p["rank"], "position_rank": pos_rank, "state_rank": state_rank,
        "schools": _schools(state, pid), "committed": status["committed"], "signed": status["signed"],
        "leaning_fcs": bool(status["fcs"]), "offered_by_you": pid in rc["offers"].get(viewer, []),
        "on_board": pid in rc["board"],
        "priorities_known": list((rc["revealed"].get(viewer) or {}).get(pid, [])),
    }
    read = rc["reads"].get(pid)
    our_grades = {g: list(recruiting.grade_range(state, pid, g)) for g in recruiting.GROUPS} if read else None
    our_comp = None
    if read and read["looks"] >= OUR_COMP_LOOKS:
        ours = {g: read["g"][g][0] for g in recruiting.GROUPS}
        our_comp = comp(_shifted(state, p, ours), p["ea_position"], starter_pool())
    details = {g: grade_detail(state, p, g, *recruiting.read_interval(state, pid, g)) for g in recruiting.GROUPS} if read else None
    return {
        "public": public,
        "grade_details": details,
        "evaluation": _evaluation(p, public_grades) if top else None,
        "public_comp": comp(_shifted(state, p, public_grades), p["ea_position"], starter_pool()) if top else None,
        "our_grades": our_grades,
        "looks": read["looks"] if read else 0,
        "our_comp": our_comp,
    }


# ----- list rows and the Recruiting tab --------------------------------------------------------------

STATUSES = ("open", "committed", "signed", "leaning_fcs", "offered", "board")


def row(state: dict, pid: str, viewer: str) -> dict:
    """A prospect as a line in a list: who he is, where he stands, what you know."""
    from sim import season
    rc = state["recruiting"]
    p, st = rc["prospects"][pid], rc["status"][pid]
    school = st["signed"] or st["committed"]
    teams = season.load_teams()
    read = rc["reads"].get(pid)
    return {
        "id": pid, "name": p["name"], "stars": p["stars"], "composite": p["composite"], "national_rank": p["rank"],
        "position": p["position"], "ea_position": p["ea_position"], "archetype": p["archetype"],
        "height": p["height"], "weight": p["weight"],
        "hometown": {"city": p["hometown"]["city"], "state": p["hometown"]["state"]},
        "committed": st["committed"], "signed": st["signed"], "leaning_fcs": bool(st["fcs"]),
        "school_name": "FCS" if school == "FCS" else (teams[school]["name"] if school else None),
        "on_board": pid in rc["board"], "offered": pid in rc["offers"].get(viewer, []),
        "looks": read["looks"] if read else 0,
        "our_potential": list(recruiting.grade_range(state, pid, "potential")) if read else None,
    }


def board_row(state: dict, pid: str, viewer: str) -> dict:
    """A board line adds your standing with him: your interest, the leader and his known priorities."""
    rc = state["recruiting"]
    out = row(state, pid, viewer)
    schools = _schools(state, pid)
    mine = next((s for s in schools if s["school"] == viewer), None)
    out.update(interest=round(recruiting.interest(state, viewer, pid), 1) if mine is None else mine["interest"],
               leader=schools[0] if schools else None, schools=len(schools),
               visit=(rc["visits"].get(pid) or {}).get(viewer),
               priorities_known=list((rc["revealed"].get(viewer) or {}).get(pid, [])),
               hc_week=((rc["contacts"].get(pid) or {}).get(viewer) or {}).get("hc_week"),
               done_this_week=[k for k, w in (((rc["contacts"].get(pid) or {}).get(viewer) or {}).get("week") or {}).items()
                               if w == state["current_week"]],
               nil=rc["nil"].get(viewer, {}).get("held", {}).get(pid, 0),
               standing=standing(state, pid, viewer))
    return out


def standing(state: dict, pid: str, viewer: str) -> dict:
    """Where you stand with him, as the board shows it: your place among the offering schools,
    your chance as a range that narrows toward signing day, and the leader. `place` is None
    until you offer."""
    from sim import season
    o = odds(state, pid)
    order = [r["school"] for r in o["schools"]]
    mine = next((r for r in o["schools"] if r["school"] == viewer), None)
    lead = o["schools"][0] if o["schools"] else None
    rnd = lambda x: round(x, 3)
    return {"place": order.index(viewer) + 1 if mine else None, "of": len(order),
            "pct": rnd(mine["pct"]) if mine else None, "lo": rnd(mine["lo"]) if mine else None,
            "hi": rnd(mine["hi"]) if mine else None, "certainty": o["certainty"], "field": rnd(o["field"]),
            "leader": {"school": lead["school"], "name": season.load_teams()[lead["school"]]["name"], "pct": rnd(lead["pct"])} if lead else None}


INTERESTED_TOP = 0.15             # "Interested in you": the prospects your school appeals to most, this share
INTEREST_LEVELS = ((0.15, "High"), (0.5, "Medium"), (1.0, "Low"))


def your_interest(state: dict, viewer: str, pids: list) -> tuple[dict, list]:
    """Each prospect's interest in your school, and the cut-offs of the levels shown (High for the
    top 15% of the class you can see, Medium for the next 35%, Low for the rest)."""
    win = recruiting._winning(state)
    vals = {pid: recruiting.interest(state, viewer, pid, win) for pid in pids}
    ordered = sorted(vals.values(), reverse=True)
    cuts = [ordered[min(len(ordered) - 1, int(share * len(ordered)))] if ordered else 0 for share, _ in INTEREST_LEVELS]
    return vals, cuts


def _level(value: float, cuts: list) -> str:
    return next((name for (_, name), cut in zip(INTEREST_LEVELS, cuts) if value >= cut), "Low")


def search(state: dict, viewer: str, position: Optional[str] = None, stars: Optional[int] = None,
           home: Optional[str] = None, status: Optional[str] = None, q: Optional[str] = None,
           offset: int = 0, limit: int = 50, sort: str = "rank") -> dict:
    """The class you can see, filtered and paged, by national rank (or by interest in your school:
    `sort="interest"`, or `status="interested"` for those your school appeals to most)."""
    rc = state["recruiting"]
    q = (q or "").strip().lower()
    out = []
    visible = recruiting.prospect_list(state)
    keen, cuts = your_interest(state, viewer, visible)
    for pid in visible:
        p, st = rc["prospects"][pid], rc["status"][pid]
        if position and position not in (p["position"], p["ea_position"]):
            continue
        if stars and p["stars"] != stars:
            continue
        if home and p["hometown"]["state"] != home:
            continue
        if q and q not in p["name"].lower():
            continue
        if status == "open" and (st["committed"] or st["signed"]):
            continue
        if status == "committed" and not (st["committed"] and not st["signed"]):
            continue
        if status == "signed" and not st["signed"]:
            continue
        if status == "leaning_fcs" and not st["fcs"]:
            continue
        if status == "offered" and pid not in rc["offers"].get(viewer, []):
            continue
        if status == "board" and pid not in rc["board"]:
            continue
        if status == "interested" and (keen[pid] < cuts[0] or st["signed"]):
            continue
        out.append(pid)
    if sort == "interest" or status == "interested":
        out.sort(key=lambda pid: -keen[pid])
    limit = max(1, min(5000, limit))
    rows = []
    for pid in out[offset:offset + limit]:
        r = row(state, pid, viewer)
        r.update(interest_in_you=round(keen[pid], 1), interest_level=_level(keen[pid], cuts))
        rows.append(r)
    return {"total": len(out), "rows": rows}


def national_classes(state: dict, viewer: Optional[str] = None) -> dict:
    """Every FBS school's class (its commitments, or signees once they sign), ranked as class_rank
    ranks them: count, stars, its three best recruits; and where the calendar is."""
    from sim import season
    rc = state["recruiting"]
    teams = season.load_teams()
    by_school: dict[str, list] = {}
    for pid, st in rc["status"].items():
        school = st["signed"] or st["committed"]
        if school and school != "FCS":
            by_school.setdefault(school, []).append(pid)
    rows = []
    for slug in recruiting.fbs_schools(state):
        pids = sorted(by_school.get(slug, []), key=lambda q: -rc["prospects"][q]["composite"])
        comps = [rc["prospects"][q]["composite"] for q in pids]
        stars = {str(n): sum(1 for q in pids if rc["prospects"][q]["stars"] == n) for n in (5, 4, 3, 2)}
        rows.append({"school": slug, "name": teams[slug]["name"], "conference": teams[slug]["conference"],
                     "count": len(pids), "signed": sum(1 for q in pids if rc["status"][q]["signed"]), "stars": stars,
                     "_points": sum(c * CLASS_DECAY ** i for i, c in enumerate(comps)), "yours": slug == viewer,
                     "top": [{"id": q, "name": rc["prospects"][q]["name"], "stars": rc["prospects"][q]["stars"],
                              "position": rc["prospects"][q]["position"], "rank": rc["prospects"][q]["rank"]} for q in pids[:3]]})
    rows.sort(key=lambda r: (-r["_points"], r["name"]))
    for r in rows:                           # ranked on the exact points, as class_rank ranks them
        r["rank"] = 1 + sum(1 for o in rows if o["_points"] > r["_points"])
    for r in rows:
        r["points"] = round(r.pop("_points"), 3)
    signed = sum(1 for st in rc["status"].values() if st["signed"])
    phase = "Signed" if signed == len(rc["status"]) else "Early signing period done" if signed else "Recruiting"
    return {"schools": rows, "phase": phase, "fcs": sum(1 for st in rc["status"].values() if st["signed"] == "FCS")}


def class_detail(state: dict, slug: str, viewer: str) -> list[dict]:
    """One school's class, best first, as list rows."""
    rc = state["recruiting"]
    pids = [pid for pid, st in rc["status"].items() if (st["signed"] or st["committed"]) == slug]
    return [row(state, pid, viewer) for pid in sorted(pids, key=lambda q: rc["prospects"][q]["rank"])]


def recruiting_view(state: dict) -> dict:
    """The Recruiting tab: your week's hours and NIL points, your board and last week's news."""
    rc, me = state["recruiting"], state["team"]
    offers = rc["offers"].get(me, [])
    nil = recruiting._nil(state, me)
    week = state["current_week"]
    mine = set(rc["board"]) | set(offers)
    board = [board_row(state, pid, me) for pid in rc["board"]]
    recap = [e for e in rc["log"] if e["week"] == week and (e.get("school") == me or e.get("from") == me or e["pid"] in mine)
             and e["kind"] != "leaning_fcs"]
    return {
        "week": week, "hours": recruiting.weekly_hours(state, me), "hours_left": recruiting._hours(state, me),
        "nil": {"budget": nil["budget"], "held": sum(nil["held"].values()), "left": recruiting.nil_left(state, me)},
        "open_spots": recruiting.open_spots(state, me), "committed": len([1 for s in rc["status"].values() if s["committed"] == me]),
        "offers": len(offers), "offers_left": recruiting.offer_cap(state, me) - len(offers),
        "board": board,
        "targets": sorted((b for b in board if b["standing"]["pct"] is not None and not b["committed"]),
                          key=lambda b: -b["standing"]["pct"])[:4],
        "class_rank": class_rank(state, me),
        "hours_used": recruiting.weekly_hours(state, me) - recruiting._hours(state, me),
        "recap": [dict(e, name=rc["prospects"][e["pid"]]["name"]) for e in recap[-60:]],
        "auto_recruit": recruiting.auto_mode(state),
        "staff": state["career"].get("staff", []), "areas": list(recruiting.AREAS),
        "area_counts": {a: sum(1 for pid in rc["prospects"] if rc["prospects"][pid]["hometown"]["state"] in states
                               and not rc["status"][pid]["signed"]) for a, states in recruiting.AREAS.items()},
        "pitches": list(recruiting.PITCHES), "hours_cost": recruiting.HOURS,
    }


# ----- the odds you see ------------------------------------------------------------------------------

ODDS_TEMPERATURE = 3.0             # interest points between two schools that make one e (2.7x) likelier *tune*
FIELD = ((0, 14.0), (8, 10.0), (16, 4.0))   # interest of the schools not yet in it, fading toward signing day *tune*
ODDS_BAND = ((0, 0.25), (8, 0.12), (13, 0.04))   # half-width of the range shown, by week *tune*
CLASS_DECAY = 0.85
CERTAINTY = ((0.18, "Early read"), (0.08, "Taking shape"), (0.0, "Solid read"))


def odds(state: dict, pid: str, week: Optional[int] = None) -> dict:
    """Each offering school's chance to land him, the field's (schools not yet in it), and the
    range around each that narrows as signing day nears: {"schools": [{school, pct, lo, hi}],
    "field", "band", "certainty"}, likeliest first."""
    rc = state["recruiting"]
    week = state["current_week"] if week is None else week
    st = rc["status"][pid]
    if st["signed"]:                           # final
        rows = [] if st["signed"] == "FCS" else [{"school": st["signed"], "pct": 1.0, "lo": 1.0, "hi": 1.0}]
        return {"schools": rows, "field": 0.0 if rows else 1.0, "band": 0.0, "certainty": "Signed", "committed": st["signed"]}
    offered = [s for s, pids in rc["offers"].items() if pid in pids]
    if st["committed"] and st["committed"] != "FCS":
        return _committed_odds(state, pid, st["committed"], offered, week)
    field = recruiting._interp(FIELD, week)
    weights = {s: math.exp(recruiting.interest(state, s, pid) / ODDS_TEMPERATURE) for s in offered}
    w_field = math.exp(field / ODDS_TEMPERATURE)
    total = sum(weights.values()) + w_field
    band = recruiting._interp(ODDS_BAND, week)
    rows = sorted(({"school": s, "pct": w / total, "lo": max(0.0, w / total - band), "hi": min(1.0, w / total + band)}
                   for s, w in weights.items()), key=lambda r: -r["pct"])
    certainty = next(label for edge, label in CERTAINTY if band >= edge)
    return {"schools": rows, "field": w_field / total, "band": band, "certainty": certainty, "committed": None}


def _committed_odds(state: dict, pid: str, school: str, offered: list, week: int) -> dict:
    """A committed prospect: his school keeps him unless he flips before signing day. The weekly
    flip chance follows the weekly draws (recruiting._draws): DECOMMIT_RATE scaled by the best
    rival's lead in interest; the flip chance is shared among the rivals as their odds."""
    from sim import season
    rivals = [s for s in offered if s != school]
    mine = recruiting.interest(state, school, pid)
    weeks_left = max(0, season.SELECTION_WEEK - week)          # the early signing period ends it for most
    if rivals:
        gap = max(recruiting.interest(state, s, pid) for s in rivals) - mine
        weekly = 2 * recruiting.DECOMMIT_RATE * recruiting._logistic(gap / recruiting.FLIP_MARGIN)
    else:
        weekly = 0.0
    flip = 1 - (1 - weekly) ** weeks_left
    weights = {s: math.exp(recruiting.interest(state, s, pid) / ODDS_TEMPERATURE) for s in rivals}
    total = sum(weights.values()) or 1.0
    band = recruiting._interp(ODDS_BAND, week) / 2
    rows = [{"school": school, "pct": 1 - flip}] + [{"school": s, "pct": flip * w / total} for s, w in weights.items()]
    for r in rows:
        r["lo"], r["hi"] = max(0.0, r["pct"] - band), min(1.0, r["pct"] + band)
    rows.sort(key=lambda r: -r["pct"])
    certainty = next(label for edge, label in CERTAINTY if band >= edge)
    return {"schools": rows, "field": 0.0, "band": band, "certainty": certainty, "committed": school}


def class_rank(state: dict, slug: str) -> int:
    """Where a school's class stands nationally: its commitments' composites, best first, each worth
    CLASS_DECAY times the one before (the best recruits count most, as in the real rankings)."""
    rc = state["recruiting"]
    by_school: dict[str, list] = {}
    for pid, st in rc["status"].items():
        school = st["signed"] or st["committed"]
        if school and school != "FCS":
            by_school.setdefault(school, []).append(rc["prospects"][pid]["composite"])
    points = {s: sum(c * CLASS_DECAY ** i for i, c in enumerate(sorted(v, reverse=True))) for s, v in by_school.items()}
    mine = points.get(slug, 0.0)
    return 1 + sum(1 for s in recruiting.fbs_schools(state) if points.get(s, 0.0) > mine)
