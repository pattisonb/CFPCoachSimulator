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


def ceiling(p: dict) -> dict:
    """A prospect's projected ratings: what a comp is measured on."""
    return p["potential_ea"]


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


def _shifted(p: dict, grades: dict[str, float]) -> dict:
    """His ceiling as a read sees it: each group's attributes moved by how far the read is off
    his true grade (grade points to rating points)."""
    groups = {"athleticism": recruiting._ATHLETIC, "size_strength": recruiting._SIZE, "football_iq": recruiting._IQ}
    out = {}
    for k, v in ceiling(p).items():
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
    rc = state["recruiting"]
    key = (state["id"], rc["year"])
    if _RANKS.get("key") != key:
        pos, home, out = {}, {}, {}
        for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
            p = rc["prospects"][pid]
            pos[p["position"]] = pos.get(p["position"], 0) + 1
            home[p["hometown"]["state"]] = home.get(p["hometown"]["state"], 0) + 1
            out[pid] = (pos[p["position"]], home[p["hometown"]["state"]])
        _RANKS.clear()
        _RANKS.update(key=key, value=out)
    return _RANKS["value"]


_RANKS: dict = {}


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
    return [{"school": s, "name": teams[s]["name"], "interest": round(v, 1), "offered": s in offers,
             "visit": visits.get(s)} for v, s in rows]


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
    if p is None or (p.get("hidden") and pid not in rc["reads"]):
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
        "priorities_known": list((rc["revealed"].get(viewer) or {}).get(pid, [])),
    }
    read = rc["reads"].get(pid)
    our_grades = {g: list(recruiting.grade_range(state, pid, g)) for g in recruiting.GROUPS} if read else None
    our_comp = None
    if read and read["looks"] >= OUR_COMP_LOOKS:
        ours = {g: read["g"][g][0] for g in recruiting.GROUPS}
        our_comp = comp(_shifted(p, ours), p["ea_position"], starter_pool())
    return {
        "public": public,
        "evaluation": _evaluation(p, public_grades) if top else None,
        "public_comp": comp(_shifted(p, public_grades), p["ea_position"], starter_pool()) if top else None,
        "our_grades": our_grades,
        "looks": read["looks"] if read else 0,
        "our_comp": our_comp,
    }
