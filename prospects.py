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

import recruiting

ROOT = Path(__file__).resolve().parent
SOURCE_TEAMS = ROOT / "cfb_sim_data" / "teams"
EVALUATED = 300                    # the top 300 get a written evaluation and a public comp
COMP_PERCENTILE = 0.30             # COMP_MAX_DISTANCE: this percentile of starter-to-starter distances *tune*
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
    """The real 2026 depth-chart starters, with their EA ratings."""
    out = []
    for path in sorted(SOURCE_TEAMS.glob("*.json")):
        t = json.loads(path.read_text(encoding="utf-8"))
        if t.get("fictional"):
            continue
        roster = {p["slug"]: p for p in t["roster"]}
        for side in (t.get("starters") or {}).values():
            for slugs in side.values():
                for slug in slugs:
                    p = roster.get(slug)
                    if p and isinstance(p.get("ratings_ea"), dict):
                        out.append({"name": p["name"], "slug": slug, "school": t["school_name"], "team": t["slug"],
                                    "position": p["position"], "ratings_ea": p["ratings_ea"],
                                    "overall_ea": p.get("overall_ea")})
    return tuple(out)


@lru_cache(maxsize=None)
def _attributes(position: str) -> tuple[str, ...]:
    starters = [s for s in starter_pool() if s["position"] == position and s.get("overall_ea")]
    if len(starters) < 3:
        return ()
    overall = [s["overall_ea"] for s in starters]

    def corr(k: str) -> float:
        try:
            return statistics.correlation([s["ratings_ea"].get(k, 0) for s in starters], overall)
        except statistics.StatisticsError:      # an attribute every starter shares
            return 0.0
    return tuple(sorted(starters[0]["ratings_ea"], key=lambda k: -corr(k))[:COMP_ATTRIBUTES])


def _distance(a: dict, b: dict, keys: tuple[str, ...]) -> float:
    return math.sqrt(sum((a.get(k, 0) - b.get(k, 0)) ** 2 for k in keys) / len(keys))


@lru_cache(maxsize=None)
def comp_max_distance(position: str) -> float:
    """COMP_MAX_DISTANCE at a position: the 30th percentile of distances between its starters."""
    starters = [s for s in starter_pool() if s["position"] == position]
    keys = _attributes(position)
    d = sorted(_distance(a["ratings_ea"], b["ratings_ea"], keys)
               for i, a in enumerate(starters) for b in starters[i + 1:])
    return d[int(COMP_PERCENTILE * (len(d) - 1))] if d else 0.0


def warm() -> None:
    """Load the starters and each position's comp distance ahead of the first profile."""
    for position in {s["position"] for s in starter_pool()}:
        comp_max_distance(position)


def ceiling(state: dict, p: dict) -> dict:
    """A prospect's projected ratings: what a comp is measured on."""
    return recruiting.attributes(state, p, "potential_ea")


def comp(profile_vector: dict, position: str, pool) -> Optional[dict]:
    """The nearest starter at the same EA position, or None when nobody is close enough."""
    keys = _attributes(position)
    if not keys:
        return None
    best = min((s for s in pool if s["position"] == position), key=lambda s: _distance(profile_vector, s["ratings_ea"], keys),
               default=None)
    if best is None or _distance(profile_vector, best["ratings_ea"], keys) > comp_max_distance(position):
        return None
    return {k: best[k] for k in ("name", "slug", "school", "team", "position", "overall_ea")}


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


def _high_school(p: dict) -> str:
    kind = random.Random(f"school-{p['id']}").choice(SCHOOL_KINDS)
    return f"{p['hometown']['city']} {kind}"


def _schools(state: dict, pid: str) -> list[dict]:
    """His list: the ten schools he likes most among those recruiting him, the leader first."""
    import season
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
    pos = p["ea_position"]
    order = sorted(EVAL_GROUPS, key=lambda g: -public[g])
    strengths = [STRENGTH_TEXT[g].format(pos=pos) for g in order[:3]]
    weaknesses = [WEAKNESS_TEXT[g].format(pos=pos) for g in order[-2:]]
    head = lambda g: GROUP_NAMES[g][0].upper() + GROUP_NAMES[g][1:]
    strengths = [f"{head(g)}: {t}" for g, t in zip(order[:3], strengths)]
    weaknesses = [f"{head(g)}: {t}" for g, t in zip(order[-2:], weaknesses)]
    return {"strengths": strengths, "weaknesses": weaknesses, "outlook": OUTLOOK.get(p["stars"], OUTLOOK[2]).format(pos=pos)}


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
    return {
        "public": public,
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
    import season
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
               nil=rc["nil"].get(viewer, {}).get("held", {}).get(pid, 0),
               standing=standing(state, pid, viewer))
    return out


def standing(state: dict, pid: str, viewer: str) -> dict:
    """Where you stand with him, as the board shows it: your place among the offering schools,
    your chance as a range that narrows toward signing day, and the leader. `place` is None
    until you offer."""
    import season
    o = odds(state, pid)
    order = [r["school"] for r in o["schools"]]
    mine = next((r for r in o["schools"] if r["school"] == viewer), None)
    lead = o["schools"][0] if o["schools"] else None
    rnd = lambda x: round(x, 3)
    return {"place": order.index(viewer) + 1 if mine else None, "of": len(order),
            "pct": rnd(mine["pct"]) if mine else None, "lo": rnd(mine["lo"]) if mine else None,
            "hi": rnd(mine["hi"]) if mine else None, "certainty": o["certainty"], "field": rnd(o["field"]),
            "leader": {"school": lead["school"], "name": season.load_teams()[lead["school"]]["name"], "pct": rnd(lead["pct"])} if lead else None}


def search(state: dict, viewer: str, position: Optional[str] = None, stars: Optional[int] = None,
           home: Optional[str] = None, status: Optional[str] = None, q: Optional[str] = None,
           offset: int = 0, limit: int = 50) -> dict:
    """The class you can see, filtered and paged, by national rank."""
    rc = state["recruiting"]
    q = (q or "").strip().lower()
    out = []
    for pid in recruiting.prospect_list(state):
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
        out.append(pid)
    limit = max(1, min(5000, limit))
    return {"total": len(out), "rows": [row(state, pid, viewer) for pid in out[offset:offset + limit]]}


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
    offered = [s for s, pids in rc["offers"].items() if pid in pids]
    field = recruiting._interp(FIELD, week)
    weights = {s: math.exp(recruiting.interest(state, s, pid) / ODDS_TEMPERATURE) for s in offered}
    w_field = math.exp(field / ODDS_TEMPERATURE)
    total = sum(weights.values()) + w_field
    band = recruiting._interp(ODDS_BAND, week)
    rows = sorted(({"school": s, "pct": w / total, "lo": max(0.0, w / total - band), "hi": min(1.0, w / total + band)}
                   for s, w in weights.items()), key=lambda r: -r["pct"])
    certainty = next(label for edge, label in CERTAINTY if band >= edge)
    return {"schools": rows, "field": w_field / total, "band": band, "certainty": certainty}


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
