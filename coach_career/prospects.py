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
STRENGTH_FROM, WEAKNESS_BELOW = 60, 45        # the game's scale: a Solid-and-up read is a strength (60), below 45 a weakness
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


def _shifted(state: dict, p: dict, grades: dict[str, float], field: str = "potential") -> dict:
    """His ceiling (`field` "potential") or his skills now ("ratings") as a read sees them: each
    group's attributes moved by how far the read is off his true grade (grade points to rating points)."""
    groups = {"athleticism": recruiting._ATHLETIC, "size_strength": recruiting._SIZE, "football_iq": recruiting._IQ}
    out = {}
    for k, v in recruiting.attributes(state, p, field).items():
        g = next((g for g, keys in groups.items() if k in keys), "technique")
        off = READ_SHIFT * (grades[g] - p["truth"][g]) + READ_SHIFT / 2 * (grades["potential"] - p["truth"]["potential"])
        out[k] = max(0, min(99, v + off))
    return out


# ----- "OC likes him": a coordinator vouches for a recruit the read says would start -------------------

LIKES_TEXT = "Your {role} thinks he starts for you next year"
COORDINATORS = {"OC": "offensive coordinator", "DC": "defensive coordinator"}
OFFENSE_GROUPS = ("QB", "RB", "WR", "TE", "OL")
KICKING_GROUPS = ("K", "P")
_LIKES: tuple = (None, {})           # (class key, {(pid, looks, viewer): the like}): a board builds hundreds of rows


def read_overall(state: dict, pid: str) -> Optional[int]:
    """His overall now as your staff's read sees it, never the truth: the midpoint of each group's read
    (recruiting.read_interval) moved onto his current attributes (_shifted, "ratings"), scored at his
    position (game_scale.overall, the roster's own scale). None before any look."""
    from teamdata import game_scale
    rc = state["recruiting"]
    p, read = rc["prospects"][pid], rc["reads"].get(pid)
    if not read:
        return None
    grades = {}
    for g in recruiting.GROUPS:
        lo, hi = recruiting.read_interval(state, pid, g)
        grades[g] = (lo + hi) / 2
    return game_scale.overall(_shifted(state, p, grades, "ratings"), p["ea_position"])


def staff_likes(state: dict, pid: str, viewer: str) -> Optional[dict]:
    """Your coordinator's word on him, from the read: {"who": "OC"|"DC", "name", "text"} when his report
    is complete (FIND_LOOKS looks, the flags' gate) and his read overall (read_overall) would start on
    your returning roster at his position group, counted as recruiting.ahead_of counts (the season's
    roster, seniors out): fewer returning players at or above him than the group starts
    (offseason.STARTERS: one QB, three receivers, five linemen ...), so a kicker or punter is liked when he
    beats your returning K or P. The OC speaks for the offense, the DC for the defense, one of them, fixed
    by the seed, for a kicker or punter; `name` is None while the slot is vacant. Never in the portal,
    never once he has signed elsewhere. Cached per read, like _ranks."""
    global _LIKES
    rc = state["recruiting"]
    p, read = rc["prospects"].get(pid), rc["reads"].get(pid)
    st = rc["status"].get(pid) or {}
    if p is None or p.get("portal") or rc.get("portal") or not recruiting.report_complete(read) or (st.get("signed") and st["signed"] != viewer):
        return None
    class_key = (state["id"], recruiting._ck(rc), rc.get("seed"))
    cached = _LIKES
    if cached[0] != class_key:
        cached = _LIKES = (class_key, {})
    key = (pid, read["looks"], tuple(read["g"][g][0] for g in recruiting.GROUPS), viewer)    # the read itself: a rewritten read at the same looks is a new one
    if key in cached[1]:
        return cached[1][key]
    from coach_career import offseason
    group = recruiting._group_of(p)
    ovr = read_overall(state, pid)
    ahead = sum(1 for o in recruiting._returning(viewer, group) if o >= ovr)
    out = None
    if ahead < offseason.STARTERS.get(group, 1):
        who = ("OC" if group in OFFENSE_GROUPS else random.Random(f"likes-{rc['seed']}-{pid}").choice(("OC", "DC")) if group in KICKING_GROUPS else "DC")
        member = next((m for m in (state.get("career") or {}).get("staff", []) if m.get("role") == who), None)
        name = member["name"] if member and member.get("name") and member["name"] != who else None
        out = {"who": who, "name": name, "text": LIKES_TEXT.format(role=COORDINATORS[who])}
    cached[1][key] = out
    return out


# ----- the profile ---------------------------------------------------------------------------------

def _public_grades(p: dict) -> dict[str, float]:
    rng = random.Random(f"public-{p['id']}")
    return {g: p["truth"][g] + rng.gauss(0, PUBLIC_SD) for g in recruiting.GROUPS}


def _ranks(state: dict) -> dict[str, tuple[int, int]]:
    """(position rank, state rank) for every prospect. Keyed by the recruiting block (recruiting._ck),
    not its year alone: the transfer portal's block shares its year with the class it replaces."""
    global _RANKS
    rc = state["recruiting"]
    key = (state["id"], recruiting._ck(rc), len(rc["prospects"]))
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
    prospects whose true grade falls in the range (at his position when there are enough). A single
    grade (lo == hi, a complete report's final grade) is described by the prospects whose true grade
    carries that word (the word's whole band), so the ranges inside the tooltip are still the middle
    half of his peers. Coachability is described by its labels instead."""
    rc = state["recruiting"]
    if lo == hi and group != "coachability":                     # one final grade: the prospects graded like that
        lo, hi = recruiting.word_band(lo)
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
    global _RANKS, _LIKES
    _LEAGUE.clear()
    _RANKS = (None, {})
    _LIKES = (None, {})
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
    ranks = rc.get("ranks", {}).get(pid) or {}
    now, prev = ranks.get("now") or {}, ranks.get("prev") or {}
    why = rc.get("why", {}).get(pid) or {}
    top = rows[0][0] if rows and rows[0][0] > 0 else 1.0
    return [{"school": s, "name": teams[s]["name"], "interest": round(v, 1), "offered": s in offers,
             "visit": visits.get(s), "pct": round(pct[s]["pct"], 3) if s in pct else None,
             "bar": round(max(0.0, min(1.0, v / top)), 3), "rank": now.get(s),
             "move": (prev[s] - now[s]) if s in prev and s in now else (None if s in now else None),
             "new": bool(now) and s in now and s not in prev,
             "why": (why.get(s) or {}).get("action")} for v, s in rows]


def _evaluation(p: dict, public: dict[str, float]) -> dict:
    """His three best and two weakest groups, written up: a strength only from Strong/Solid up (60), a weakness
    only below Fair (45); anything between is "solid" (a five-star's lowest grade is often still good)."""
    pos = p["ea_position"]
    order = sorted(EVAL_GROUPS, key=lambda g: -public[g])
    head = lambda g: GROUP_NAMES[g][0].upper() + GROUP_NAMES[g][1:]
    strengths, solid, weaknesses = [], [], []
    for g in order[:3]:
        (strengths if public[g] >= STRENGTH_FROM else solid).append(f"{head(g)}: " + (STRENGTH_TEXT[g] if public[g] >= STRENGTH_FROM else SOLID_TEXT).format(pos=pos))
    for g in order[-2:]:
        (weaknesses if public[g] < WEAKNESS_BELOW else solid).append(f"{head(g)}: " + (WEAKNESS_TEXT[g] if public[g] < WEAKNESS_BELOW else SOLID_TEXT).format(pos=pos))
    return {"strengths": strengths, "solid": solid, "weaknesses": weaknesses, "outlook": OUTLOOK.get(recruiting.tier_of(p), OUTLOOK[2]).format(pos=pos)}


def generational_seen(rc: dict, pid: str, viewer: str) -> bool:
    """The Generational tag as `viewer` sees it: drawn for him (recruiting.draw_generational) and
    found by your staff once his report is complete (the same test as a gem or a bust risk: no
    flag at 2 or 2.5 looks), or shown once he has signed with you. The CPU never reads this; it
    recruits him as the top prospect he is either way."""
    if rc.get("portal") or pid not in (rc.get("generational") or ()):
        return False
    return recruiting.report_complete(rc["reads"].get(pid)) or (viewer is not None and rc["status"][pid]["signed"] == viewer)


def find(state: dict, pid: str) -> Optional[str]:
    """Your staff's finding from the read, never the truth: "gem", "bust" or None. Needs a complete
    report (REPORT_LOOKS looks: no flag at 2 or 2.5); portal prospects get none. The cuts are relative to his star tier (recruiting.flag_cuts):
    a gem is a three-star or less ranked past GEM_RANK whose potential read, even at its low end,
    beats the GEM_PERCENTILE (94th) of true potential at his star level; a bust risk is a four- or
    five-star whose read, even at its high end, sits under the BUST_PERCENTILE (1.75th) of his. A flag
    holds: `read["find"]`, the finding after his last look (look() keeps it), stays until the read
    moves FLAG_HOLD points back past its cut, so one look that widens the read does not flicker it."""
    rc = state["recruiting"]
    p, read = rc["prospects"][pid], rc["reads"].get(pid)
    if p.get("portal") or p["stars"] is None or not read or not recruiting.report_complete(read):
        return None
    mean, half = recruiting.read_spread(state, pid, "potential")      # the read's own spread: the final grade's collapse to one point (read_interval) does not move a flag's cut
    lo, hi = mean - half, mean + half
    gem_cut, bust_cut = recruiting.flag_cuts(rc).get(p["stars"], (99.0, -1.0))
    held = read.get("find")
    if p["stars"] <= 3 and p["rank"] > recruiting.GEM_RANK and lo >= gem_cut - (recruiting.FLAG_HOLD if held == "gem" else 0.0):
        return "gem"
    if p["stars"] >= 4 and hi < bust_cut + (recruiting.FLAG_HOLD if held == "bust" else 0.0):
        return "bust"
    return None


FLIP_WORDS = ((0.15, "Likely"), (0.05, "Real"), (0.0, "Slim"))     # a flip chance as a word: at or past the share; exactly 0 is "None"


def flip_word(pct: float) -> str:
    """A flip chance (a share, 0-1) as the game says it: None, Slim (under 5%), Real (under 15%), Likely."""
    if pct <= 0:
        return "None"
    return next(w for edge, w in FLIP_WORDS if pct >= edge)


def flip_view(state: dict, pid: str) -> Optional[dict]:
    """A committed prospect's chance to flip before signing day, in words, never a number: {"total": the
    rivals' share together, "word": its word ("Locked In" on a hard commit), "rivals": [{school, name, pct,
    word}] by pct, the offering schools other than the one he holds}. None unless he holds a verbal or hard
    commitment to an FBS school (signed, or uncommitted: nothing to flip from)."""
    from sim import season
    rc = state["recruiting"]
    st = rc["status"][pid]
    if st["signed"] or not st["committed"] or st["committed"] == "FCS":
        return None
    o = odds(state, pid)
    teams = season.load_teams()
    rivals = sorted((r for r in o["schools"] if r["school"] != st["committed"]), key=lambda r: -r["pct"])
    total = round(min(1.0, sum(r["pct"] for r in rivals)), 4)
    return {"total": total, "word": "Locked In" if st.get("hard") else flip_word(total),
            "rivals": [{"school": r["school"], "name": teams[r["school"]]["name"], "pct": round(r["pct"], 4), "word": flip_word(r["pct"])} for r in rivals]}


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
        "generational": generational_seen(rc, pid, viewer), "find": find(state, pid),
        "national_rank": p["rank"], "position_rank": pos_rank, "state_rank": state_rank,
        "schools": _schools(state, pid), "committed": status["committed"], "signed": status["signed"],
        "hard": bool(status.get("hard")) and not status["signed"],
        "leaning_fcs": bool(status["fcs"]), "offered_by_you": pid in rc["offers"].get(viewer, []),
        "on_board": pid in rc["board"],
        "trips": ((rc["contacts"].get(pid) or {}).get(viewer) or {}).get("scouted", 0),
        "priorities_known": list((rc["revealed"].get(viewer) or {}).get(pid, [])),
    }
    read = rc["reads"].get(pid)
    our_grades = {g: list(recruiting.grade_range(state, pid, g)) for g in recruiting.GROUPS} if read else None
    our_comp = None
    if read and recruiting.report_looks(read) >= OUR_COMP_LOOKS:
        ours = {g: read["g"][g][0] for g in recruiting.GROUPS}
        our_comp = comp(_shifted(state, p, ours), p["ea_position"], starter_pool())
    details = {g: grade_detail(state, p, g, *recruiting.read_interval(state, pid, g)) for g in recruiting.GROUPS} if read else None
    return {
        "public": public,
        "flip": flip_view(state, pid),
        "grade_details": details,
        "evaluation": _evaluation(p, public_grades) if top else None,
        "public_comp": comp(_shifted(state, p, public_grades), p["ea_position"], starter_pool()) if top else None,
        "our_grades": our_grades,
        "looks": looks_out(read),
        "our_comp": our_comp,
        "likes": staff_likes(state, pid, viewer),
        "can_scout": can_scout(state, viewer, pid),
        "ratings": signed_ratings(state, p) if status["signed"] == viewer else None,     # signing day shows what you got
        "ask": recruiting.ask_view(state, viewer, pid), "cooled": recruiting.cooled(state, viewer, pid),
        "stage": recruiting.stage(state, viewer, pid), "strength": recruiting.strengths(state, viewer, pid),
        "pestering": recruiting.would_pester(state, viewer, pid), "pesters": recruiting.pesters(state, viewer, pid),
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
        "generational": generational_seen(rc, pid, viewer), "find": find(state, pid),
        "position": p["position"], "ea_position": p["ea_position"], "archetype": p["archetype"],
        "height": p["height"], "weight": p["weight"], "home": p["home"],
        "hometown": {"city": p["hometown"]["city"], "state": p["hometown"]["state"]},
        "committed": st["committed"], "signed": st["signed"], "leaning_fcs": bool(st["fcs"]),
        "school_name": "FCS" if school == "FCS" else (teams[school]["name"] if school else None),
        "on_board": pid in rc["board"], "offered": pid in rc["offers"].get(viewer, []),
        "group": recruiting._group_of(p),
        "looks": looks_out(read), "scouted": recruiting.report_complete(read), "likes": staff_likes(state, pid, viewer),
        "trips": ((rc["contacts"].get(pid) or {}).get(viewer) or {}).get("scouted", 0),
        "our_potential": list(recruiting.grade_range(state, pid, "potential")) if read else None,
        "our_grades": {g: list(recruiting.grade_range(state, pid, g)) for g in recruiting.GROUPS} if read else None,
        **({"portal": True, "from": p["from"], "from_name": p["from_name"], "cls": p["cls"], "usage": p.get("usage"),
            "line": p.get("line"), "portal_rank": p.get("portal_rank")} if p.get("portal") else {}),
    }


def _role(playing_time: float) -> str:
    return "Would start" if playing_time >= 0.9 else "Next in line" if playing_time >= 0.5 else "Depth"


def _stage_move(state: dict, pid: str, viewer: str) -> Optional[str]:
    """Which way he moved across the board's columns at the last week step (None: no snapshot, no change)."""
    snap = (state["recruiting"].get("stages") or {}).get(pid)
    st = state["recruiting"]["status"][pid]
    if not snap or snap["week"] < state["current_week"] - 1 or (st["committed"] or st["signed"]) not in (None, viewer):
        return None
    if snap["now"] not in recruiting.STAGES or snap["prev"] not in recruiting.STAGES:
        return None
    d = recruiting.STAGES.index(snap["now"]) - recruiting.STAGES.index(snap["prev"])
    return "up" if d > 0 else "down" if d < 0 else None


HISTORY_SHOWN = 40                           # a board row's History: his newest log entries, this many
HIS_OWN = ("commit", "hard", "flip", "decommit", "signed", "leaning_fcs")   # his own moves: every school's show
HISTORY_KEYS = ("week", "kind", "action", "pitch", "nil", "reaction", "school", "answer", "about", "truthful")


def history_index(state: dict, viewer: str) -> dict[str, list[dict]]:
    """One pass over the log: each prospect's History for the viewer, newest first and capped. His
    own moves and any school's offer show; everything else only when it is the viewer's."""
    out: dict[str, list[dict]] = {}
    for e in reversed(state["recruiting"]["log"]):
        if e.get("school") != viewer and e["kind"] not in HIS_OWN and e["kind"] != "offer":
            continue
        rows = out.setdefault(e["pid"], [])
        if len(rows) < HISTORY_SHOWN:
            rows.append({k: e[k] for k in HISTORY_KEYS if e.get(k) is not None})
    return out


def board_row(state: dict, pid: str, viewer: str, history: Optional[dict] = None) -> dict:
    """A board line adds your standing with him: your interest, the leader and his known priorities,
    and his History (`history`: a `history_index` built once per view; without it, one pass for him)."""
    rc = state["recruiting"]
    if history is None:
        history = history_index(state, viewer)
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
               need=recruiting.needs(state, viewer)[recruiting._group_of(rc["prospects"][pid])],
               ask=recruiting.ask_view(state, viewer, pid), cooled=recruiting.cooled(state, viewer, pid),
               stage=recruiting.stage(state, viewer, pid), strength=recruiting.strengths(state, viewer, pid),
               pestering=recruiting.would_pester(state, viewer, pid), pesters=recruiting.pesters(state, viewer, pid),
               stage_move=_stage_move(state, pid, viewer),
               scene=((rc.get("scenes") or {}).get(viewer) or {}).get(pid),
               list=[dict(x, you=x["school"] == viewer) for x in _schools(state, pid)[:5]],
               firmness=rc["status"][pid].get("firmness") if rc["status"][pid]["committed"] == viewer and not rc["status"][pid]["signed"] else None,
               hard=bool(rc["status"][pid].get("hard")) and not rc["status"][pid]["signed"],
               can_scout=can_scout(state, viewer, pid),
               role=_role(recruiting.pull(state, viewer, pid)["playing_time"]),
               standing=standing(state, pid, viewer),
               history=history.get(pid, []))
    return out


def looks_out(read: Optional[dict]):
    """A read's looks for a view: in trip units, never past REPORT_LOOKS, whole numbers as ints (2, 1.5, 3)."""
    n = recruiting.report_looks(read)
    return int(n) if n == int(n) else n


def can_scout(state: dict, viewer: str, pid: str) -> bool:
    """Whether you can still send a scout: not once he has signed or committed to you, nor once his report is complete."""
    rc = state["recruiting"]
    st = rc["status"][pid]
    return not st["signed"] and st["committed"] != viewer and not recruiting.report_complete(rc["reads"].get(pid))


def signed_ratings(state: dict, p: dict) -> dict:
    """A signee's full ratings, as his roster card will show them: every attribute now and at his
    potential, with his overall and projected overall."""
    from teamdata import game_scale
    from teamdata import ratings as rv2
    keys = list(game_scale.keys())
    rows = [{"key": k, "label": rv2.ATTRIBUTES[k][0] if k in rv2.ATTRIBUTES else k.replace("_", " ").title(),
             "value": v, "potential": q} for k, v, q in zip(keys, p["ratings"], p["potential"])]
    return {"overall": p["ovr"], "potential_overall": p["pot_ovr"], "attributes": rows}


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
           offset: int = 0, limit: int = 50, sort: str = "rank", group: Optional[str] = None) -> dict:
    """The class you can see, filtered and paged, by national rank (or by interest in your school:
    `sort="interest"`, or `status="interested"` for those your school appeals to most)."""
    rc = state["recruiting"]
    q = (q or "").strip().lower()
    out = []
    visible = recruiting.prospect_list(state)
    keen, cuts = your_interest(state, viewer, visible)
    recs = {r["pid"]: r for r in recruiting.recommended(state, viewer)} if status == "recommended" else {}
    for pid in visible:
        p, st = rc["prospects"][pid], rc["status"][pid]
        if position and position not in (p["position"], p["ea_position"]):
            continue
        if group and recruiting._group_of(p) != group:
            continue
        if status == "recommended" and pid not in recs:
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
    elif status == "recommended":
        out.sort(key=lambda pid: -recs[pid]["fit"])
    limit = max(1, min(5000, limit))
    rows = []
    for pid in out[offset:offset + limit]:
        r = row(state, pid, viewer)
        r.update(interest_in_you=round(keen[pid], 1), interest_level=_level(keen[pid], cuts),
                 can_scout=can_scout(state, viewer, pid), hard=bool(rc["status"][pid].get("hard")) and not rc["status"][pid]["signed"])
        if pid in recs:
            r["why"] = recs[pid]["why"]
        rows.append(r)
    return {"total": len(out), "rows": rows, "needs": recruiting.needs_detail(state, viewer), "recommended_ids": list(recs)}


class class_block:
    """`with class_block(state):` the high school class is the recruiting block for the calls inside
    (during the portal weeks the transfer pool holds that place; the classes views need the class)."""

    def __init__(self, state: dict):
        self.state, self.swapped = state, False

    def __enter__(self):
        rc = self.state.get("recruiting") or {}
        if rc.get("portal") and self.state.get("recruiting_last"):
            self.state["recruiting"], self.state["recruiting_last"] = self.state["recruiting_last"], rc
            self.swapped = True
        return self.state

    def __exit__(self, *exc):
        if self.swapped:
            self.state["recruiting"], self.state["recruiting_last"] = self.state["recruiting_last"], self.state["recruiting"]


def class_rc(state: dict) -> dict:
    """The high school class's recruiting block (during the portal weeks, the signed class kept aside)."""
    rc = state["recruiting"]
    return state.get("recruiting_last") or rc if rc.get("portal") else rc


def national_classes(state: dict, viewer: Optional[str] = None) -> dict:
    """Every FBS school's class (its commitments, or signees once they sign), ranked as class_rank
    ranks them: count, stars, its three best recruits; and where the calendar is."""
    from sim import season
    rc = class_rc(state)
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
                              "position": rc["prospects"][q]["position"], "rank": rc["prospects"][q]["rank"],
                              "generational": generational_seen(rc, q, viewer)} for q in pids[:3]]})
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
    rc = class_rc(state)
    pids = [pid for pid, st in rc["status"].items() if (st["signed"] or st["committed"]) == slug]
    rows = [row(state, pid, viewer) for pid in sorted(pids, key=lambda q: rc["prospects"][q]["rank"])]
    for r in rows:                           # his real ratings show once he signs with you: did the find hold?
        if r["signed"] == viewer:
            truth = rc["prospects"][r["id"]]["truth"]["potential"]
            r["find_held"] = None if r["find"] is None else (truth >= 80 if r["find"] == "gem" else truth < 50)
    return rows


def recruiting_view(state: dict) -> dict:
    """The Recruiting tab: your week's hours and NIL points, your board and last week's news."""
    rc, me = state["recruiting"], state["team"]
    offers = rc["offers"].get(me, [])
    nil = recruiting._nil(state, me)
    week = state["current_week"]
    mine = set(rc["board"]) | set(offers)
    hist = history_index(state, me)
    board = [board_row(state, pid, me, hist) for pid in rc["board"]]
    recap = [e for e in rc["log"] if e["week"] == week and (e.get("school") == me or e.get("from") == me or e["pid"] in mine)
             and e["kind"] not in ("leaning_fcs",) + recruiting.CONTACT_KINDS]
    return {
        "week": week, "hours": recruiting.weekly_hours(state, me), "hours_left": recruiting._hours(state, me),
        "nil": {"budget": nil["budget"], "held": sum(nil["held"].values()), "left": recruiting.nil_left(state, me),
                "base": recruiting.nil_budget(state, me),                      # the year's budget alone (the class: budget = base + carry)
                "pool": nil["budget"] if rc.get("portal") else None,            # the portal: the pool less what keeping players home cost
                "carry": None if rc.get("portal") else int(nil.get("carry") or 0)},   # the class: last year's portal NIL carried over
        "open_spots": recruiting.open_spots(state, me), "committed": len([1 for s in rc["status"].values() if s["committed"] == me]),
        "needs": recruiting.needs(state, me),
        "needs_detail": recruiting.needs_detail(state, me),
        "report": recruiting.latest_report(state),
        "portal": {"week": rc.get("week"), "weeks": rc.get("weeks", 4), "entrants": len(rc["prospects"]),
                   "signed": sum(1 for s_ in rc["status"].values() if s_["signed"])} if rc.get("portal") else None,
        "offers": len(offers), "offers_left": recruiting.offer_cap(state, me) - len(offers),
        "board": board,
        "targets": sorted((b for b in board if b["standing"]["pct"] is not None and not b["committed"]),
                          key=lambda b: -b["standing"]["pct"])[:4],
        "class_rank": class_rank(state, me),
        "hours_used": recruiting.weekly_hours(state, me) - recruiting._hours(state, me),
        "recap": [dict(e, name=rc["prospects"][e["pid"]]["name"]) for e in recap[-60:]],
        "auto_recruit": recruiting.auto_mode(state),
        "staff": state["career"].get("staff", []), "areas": {a: list(states) for a, states in recruiting.AREAS.items()},
        "area_counts": {a: sum(1 for pid in rc["prospects"] if rc["prospects"][pid]["hometown"]["state"] in states
                               and not rc["status"][pid]["signed"]) for a, states in recruiting.AREAS.items()},
        "pitches": list(recruiting.PITCHES), "hours_cost": recruiting.HOURS,
    }


# ----- the Scouting tab -------------------------------------------------------------------------------

ROLE_NAMES = {"OC": "Offensive coordinator", "DC": "Defensive coordinator", "Recruiter": "Recruiter"}
NOT_ENOUGH_HOURS = "Not enough hours"
REPORT_COMPLETE = f"His report is complete: {recruiting.REPORT_LOOKS} of {recruiting.REPORT_LOOKS} looks"   # a board row kept in the queue with no Send
REPORT_ITEMS = recruiting.LOOK_LOG_KEEP   # a scout's report lists this many of his changed looks: flags, then potential, then the rest
LOOK_NAMES = dict(GROUP_NAMES, potential="potential")
STANDING_WORDS = {"cold": "Not yet contacted", "contact": "In contact", "top": "In his top group", "visited": "Visited",
                  "committed": "Committed to you"}


def _look_change(e: dict) -> str:
    """What a logged look changed, in words: potential first, else the first group whose words moved
    ("narrowed to" when the range tightened, "now" when it shifted, "first read:" for his first look); "" for none."""
    for g in _LOOK_ORDER:
        after, before = e["after"].get(g), e["before"].get(g)
        if after is None:
            continue
        name = LOOK_NAMES[g]
        words = f"{after[0]}–{after[1]}" if after[0] != after[1] else after[0]
        if before is None:
            return f"first read: {name} {words}"
        width = lambda r: recruiting.WORDS.index(r[0]) - recruiting.WORDS.index(r[1])
        return f"{name} {'narrowed to' if width(after) < width(before) else 'now'} {words}"
    return ""


_LOOK_ORDER = ("potential",) + tuple(g for g in recruiting.GROUPS if g != "potential")


def _report_groups(state: dict, entries: list[dict], counts: dict, changes: dict, staff: dict) -> list[dict]:
    """One week's look log as the desk's reports: grouped by scout in order of the newest logged look
    (then the scouts whose looks changed nothing, in staff order), each group's looks counted (`looks`,
    from the week's tally), the looks that changed a grade word or gained a flag counted (`changed`,
    from the tally) and the most notable REPORT_ITEMS of them listed (flags, then potential, then the
    rest; newest first within each)."""
    rc = state["recruiting"]
    groups: dict[str, dict] = {}
    kept: dict[str, list[dict]] = {}

    def group(by: str) -> dict:
        g = groups.get(by)
        if g is None:
            member = staff.get(by)
            g = groups[by] = {"scout_id": by, "scout": member["name"] if member else "Your trips",
                              "area": member.get("area") if member else None, "looks": counts.get(by, 0),
                              "changed": (changes.get(by) or {}).get("changed", 0), "items": []}
        return g

    for e in reversed(entries):
        group(e["by"])
        kept.setdefault(e["by"], []).append(e)
    for by in list(staff) + ["trip"]:
        if counts.get(by):
            group(by)
    for by, g in groups.items():
        for e in sorted(kept.get(by, []), key=recruiting.look_notability)[:REPORT_ITEMS]:
            p = rc["prospects"][e["pid"]]
            g["items"].append({"pid": e["pid"], "name": p["name"], "position": p["position"], "stars": p["stars"],
                               "change": _look_change(e), "flags": list(e["flags"]), "likes": staff_likes(state, e["pid"], state["team"])})
    return list(groups.values())


QUEUE_LIMIT, QUEUE_MAX = 120, 400            # the queue's page: the default and the most rows one ask returns
FLAG_ORDER = ("generational", "gem", "likes", "bust")   # the Flags list: the liked recruits after the gems


def scouting_view(state: dict, q: Optional[str] = None, position: Optional[str] = None, group: Optional[str] = None,
                  offset: int = 0, limit: int = QUEUE_LIMIT) -> dict:
    """The Scouting tab: your scouts and this week's yield (looks in trip units: an area week counts
    0.5), one page of the queue of recruits worth a trip (your board's one Send from complete first,
    then the board's open reports, then the board's complete reports (kept in view with no Send:
    `can_send` False, `why` REPORT_COMPLETE), then the class's open reports by need and rank; a
    complete report off your board is out of the queue; filtered by `q`
    on name or home state, `position`, `group`; `queue_total` counts the whole match), this and last
    week's reports from the look log, and your staff's flags this class (gems, bust risks, generational
    prospects and the recruits a coordinator likes: staff_likes), every row carrying `likes`."""
    rc, me = state["recruiting"], state["team"]
    week = recruiting.look_week(state)
    staff = {m["id"]: m for m in state["career"].get("staff", [])}
    log = rc.get("looks") or []
    counts, changes = rc.get("look_counts") or {}, rc.get("look_changes") or {}
    this_count, last_count = counts.get(str(week)) or {}, counts.get(str(week - 1)) or {}
    this_changes, last_changes = changes.get(str(week)) or {}, changes.get(str(week - 1)) or {}
    this_week = [e for e in log if e["week"] == week]
    last_week = [e for e in log if e["week"] == week - 1]
    hours_left = recruiting._hours(state, me)
    need = recruiting.needs(state, me)
    live = {pid for pid, st in rc["status"].items() if not st["signed"] and st["committed"] != me}
    scouts = []
    for m in staff.values():
        codes = recruiting.AREAS.get(m.get("area"), [])
        mine = this_changes.get(m["id"]) or {}
        scouts.append({"id": m["id"], "name": m["name"], "role": ROLE_NAMES.get(m["role"], m["role"]),
                       "evaluation_word": recruiting.word(m["evaluation"]), "area": m.get("area"), "contract_until": m.get("contract_until"),
                       "looking_at": sum(1 for pid in live if rc["prospects"][pid]["hometown"]["state"] in codes
                                         and recruiting.area_open(rc["reads"].get(pid))),
                       "yield": {"looks": this_count.get(m["id"], 0), "narrowed": mine.get("changed", 0),
                                 "flags": mine.get("flags", 0)}})
    text = (q or "").strip().lower()
    want_pos, want_group = (position or "").upper() or None, (group or "").upper() or None

    def fits(p: dict) -> bool:
        if want_pos and p["position"].upper() != want_pos or want_group and recruiting._group_of(p) != want_group:
            return False
        return not text or text in p["name"].lower() or text == p["hometown"]["state"].lower()

    complete = lambda pid: recruiting.report_complete(rc["reads"].get(pid))
    board = [pid for pid in rc["board"] if pid in live]
    # one Send from complete first, then the board's open reports, then its complete ones (they stay listed: no Send, a Complete tag)
    board.sort(key=lambda pid: 2 if complete(pid) else 0 if recruiting.looks_left(rc["reads"].get(pid)) <= recruiting.SEND_LOOK else 1)
    rest = sorted((pid for pid in recruiting.visible(state) if pid in live and pid not in rc["board"] and not complete(pid)),
                  key=lambda pid: (-need[recruiting._group_of(rc["prospects"][pid])], rc["prospects"][pid]["rank"]))
    trips_of = lambda pid: ((rc["contacts"].get(pid) or {}).get(me) or {}).get("scouted", 0)
    matched = [pid for pid in board + rest if fits(rc["prospects"][pid])]
    limit = max(1, min(int(limit), QUEUE_MAX))
    offset = max(0, int(offset))
    queue = []
    for pid in matched[offset:offset + limit]:
        p, read, trips = rc["prospects"][pid], rc["reads"].get(pid), trips_of(pid)
        short = hours_left < recruiting.HOURS["scout"]
        done = complete(pid)
        queue.append({"pid": pid, "name": p["name"], "position": p["position"], "stars": p["stars"],
                      "group": recruiting._group_of(p), "need": need[recruiting._group_of(p)], "national_rank": p["rank"],
                      "looks": looks_out(read), "trips": trips,
                      "potential": list(recruiting.grade_range(state, pid, "potential")) if read else None,
                      "can_send": not short and not done, "why": REPORT_COMPLETE if done else NOT_ENOUGH_HOURS if short else None,
                      "state": p["hometown"]["state"], "likes": staff_likes(state, pid, me)})
    flags = []
    for pid in rc["reads"]:
        p = rc["prospects"].get(pid)
        if p is None:
            continue
        likes = staff_likes(state, pid, me)
        for flag in recruiting._flags(state, pid) + (["likes"] if likes else []):
            flags.append({"pid": pid, "name": p["name"], "position": p["position"], "stars": p["stars"], "flag": flag,
                          "looks": looks_out(rc["reads"][pid]), "likes": likes,
                          "standing_word": _standing_word(state, pid, me)})
    flags.sort(key=lambda f: (FLAG_ORDER.index(f["flag"]), rc["prospects"][f["pid"]]["rank"]))
    return {"hours": recruiting.weekly_hours(state, me), "hours_left": hours_left, "scouts": scouts,
            "queue": queue, "queue_total": len(matched),
            "reports": {"this_week": _report_groups(state, this_week, this_count, this_changes, staff),
                        "last_week": _report_groups(state, last_week, last_count, last_changes, staff)},
            "flags": flags}


def _standing_word(state: dict, pid: str, me: str) -> str:
    """Where he stands with you, in a few words: signed or committed (to you or elsewhere), else your stage with him."""
    from sim import season
    st = state["recruiting"]["status"][pid]
    if st["signed"] == me:
        return "Signed with you"
    if st["signed"] or st["committed"] not in (None, me):
        school = st["signed"] or st["committed"]
        name = "FCS" if school == "FCS" else season.load_teams()[school]["name"]
        return f"{'Signed' if st['signed'] else 'Committed'} to {name}"
    return STANDING_WORDS[recruiting.stage(state, me, pid)]


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
        flip = recruiting.flip_by_signing(state, pid, gap, weeks_left)
    else:
        flip = 0.0
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
    rc = class_rc(state)
    by_school: dict[str, list] = {}
    for pid, st in rc["status"].items():
        school = st["signed"] or st["committed"]
        if school and school != "FCS":
            by_school.setdefault(school, []).append(rc["prospects"][pid]["composite"])
    points = {s: sum(c * CLASS_DECAY ** i for i, c in enumerate(sorted(v, reverse=True))) for s, v in by_school.items()}
    mine = points.get(slug, 0.0)
    return 1 + sum(1 for s in recruiting.fbs_schools(state) if points.get(s, 0.0) > mine)
