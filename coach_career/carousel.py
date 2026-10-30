"""The coaching carousel of a Coach Career (docs/superpowers/specs/2026-10-23-career-offseason-design.md,
section 7): every program's athletic director sets a goal from the program's standing and has so
much patience; each head coach's job security moves with his results against it. After the
season coaches are fired, retire or leave for the NFL; the openings are filled in order of the
program's prestige from hot head coaches at smaller programs, top coordinators and generated
candidates, so one hire opens another job. Coordinators are poached the same way. You get a goal
and job security too: after a big year better programs with an opening may offer you their job,
and if your AD runs out of patience you pick a new job from the openings.

    league team["ad"] = {"patience": 2-5, "security": 0-100}
    state["offseason"]["carousel"] = {"changes": [...], "openings": [...], "you": {...}, "offers": [...], "choice": slug|None}
"""
from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Optional

from coach_career import programs, recruits

# goals, by the program's recruiting baseline (about -2 to +2): (from, kind, wins, words) *tune*
GOALS = ((1.2, "playoff", 10, "Make the College Football Playoff"), (0.5, "wins", 9, "Win nine games"),
         (-0.3, "wins", 7, "Win seven games and go bowling"), (-10, "wins", 6, "Reach a bowl game"))
G5_TITLE_FROM = 0.0              # a Group of 5 program this strong expects to win its conference
START_SECURITY = 70
STANDING = (35, 85)              # a sitting coach's unknown standing when the career starts (third season on) *tune*
HONEYMOON = 2                    # a new coach's first seasons count half against him
WIN_STEP = 8                     # security per win over or under the goal
BONUS = {"conference": 10, "playoff": 12, "title": 25}
FIRE_BELOW, FIRE_CHANCE, MUST_FIRE = 25, 0.7, 8
RETIRE = 0.03                    # a year, more after 12 seasons in the job and past 60 (an age drawn when unknown)
NFL_CHANCE = 0.12                # a 80+ head coach after 10 wins
COORD_MOVE = 0.13                # coordinators leaving for other jobs on their own
HC_MOVE_PCT = 0.55               # a sitting head coach with this winning share over three years is a candidate elsewhere
MOVE_UP = 3                      # a sitting head coach takes an opening this much more attractive than his own job
COORD_UP = -15                   # a coordinator takes a head coaching job at any program within this of his own
HC_PROVEN = 8                    # a sitting head coach's edge over a coordinator or a market coach
OFFER_FROM = 80                  # your security this high, and better programs with an opening call
FIRED_PICKS = 6                  # openings offered to you after you are fired (the lower ones)
MARKET_SIZE = 150                # coaches for hire the market is topped up to each offseason *tune*
MARKET_STALE = 3                 # years in the market before a coach retires from it
SUPPLY_LEVEL, SUPPLY_SPREAD = -10.0, 10.0   # the generated supply's level against the league's coaches: most are bottom-tier material
OWN_STAFF = 0.5                  # a new head coach brings his own coordinator this often
COORD_ROLES = ("offensive_coordinator", "defensive_coordinator")
ROLE_WORDS = {"head_coach": "head coach", "offensive_coordinator": "offensive coordinator",
              "defensive_coordinator": "defensive coordinator"}


def _rng(state: dict, what: str) -> random.Random:
    from coach_career.offseason import seed_key
    return random.Random(f"carousel-{seed_key(state)}-{state.get('year', 2026)}-{what}")


def baseline(slug: str) -> float:
    from coach_career import recruiting
    return recruiting._baseline(slug)


def goal(slug: str, state: Optional[dict] = None) -> dict:
    """What the AD expects every year: by the program's tier (the living rating)."""
    from coach_career import programs
    from sim import season
    p4 = season._is_p4(slug, season.load_teams()[slug])
    p = programs.get(state or {}, slug)
    return programs.goal_for(p["tier"], p4, p["rating"])


def attract(state: dict, slug: str) -> float:
    from coach_career import programs
    return programs.attract(state, slug)


def ad(team: dict, slug: str, year: Optional[int] = None) -> dict:
    """The program's AD (patience fixed per program, drawn once) and the head coach's security. A
    coach already in his third season or later starts with a standing we do not know: drawn
    between STANDING (some sit on hot seats); a newer coach starts at START_SECURITY."""
    if "ad" not in team:
        r = random.Random(f"ad-{slug}")
        tier = programs.base(slug)["tier"]
        base = 2 if tier == 1 else 3 if tier == 2 else 4
        hc = (team.get("coaches") or {}).get("head_coach") or {}
        tenure = (year - (hc.get("since") or year)) if year else 0
        sec = START_SECURITY if tenure < 2 else random.Random(f"standing-{slug}-{hc.get('name')}").randint(*STANDING)
        team["ad"] = {"patience": max(2, min(5, base + r.choice((-1, 0, 0, 1)))), "security": sec}
    return team["ad"]


def _results(state: dict) -> dict[str, dict]:
    """Each program's season: wins, losses, conference title, playoff, national title."""
    from sim import season
    recs = season._records(state, include_playoff=True)
    playoff = {g[s] for g in state["games"].values() if g.get("kind") == "playoff" for s in ("home", "away")}
    champs = set((state.get("champions") or {}).values())
    return {slug: {"wins": r["wins"], "losses": r["losses"], "conference": slug in champs, "playoff": slug in playoff,
                   "title": state.get("champion") == slug} for slug, r in recs.items()}


def judge(team: dict, slug: str, res: dict, year: int, state: Optional[dict] = None) -> dict:
    """The AD's verdict on a season: security moves with wins against the goal and the honors."""
    a = ad(team, slug, year)
    g = goal(slug, state)
    hc = team["coaches"]["head_coach"]
    tenure = year - (hc.get("since") or 2020)
    delta = WIN_STEP * (res["wins"] - g["wins"])
    if g["kind"] == "playoff" and not res["playoff"]:
        delta -= 6
    if g["kind"] == "conference" and not res["conference"]:
        delta -= 6
    for k, v in BONUS.items():
        if res.get(k):
            delta += v
    if delta < 0:
        delta *= 3 / a["patience"]                      # an impatient AD feels a bad year more
        if tenure <= HONEYMOON:
            delta /= 2
    a["security"] = int(max(0, min(100, a["security"] + delta)))
    met = res["wins"] >= g["wins"] and (g["kind"] != "playoff" or res["playoff"]) and (g["kind"] != "conference" or res["conference"])
    return {"goal": g, "met": met, "security": a["security"], "delta": int(round(delta)), "tenure": tenure, "patience": a["patience"]}


def new_style(rng: random.Random, lgd: dict, slug: str) -> str:
    """A new head coach brings his own way of playing: the observed 2026 style of a real program
    (data/observed_tendencies.json), so every team keeps playing like a real one does."""
    from teamdata import build_teams
    obs = json.loads(build_teams.OBSERVED.read_text(encoding="utf-8"))["teams"] if build_teams.OBSERVED.exists() else {}
    pool = sorted(s for s, o in obs.items() if o.get("games", 0) >= 2 and s != slug)
    return rng.choice(pool) if pool else slug


def _rating(c: dict) -> float:
    r = c.get("ratings") or {}
    return r.get("overall") or (r.get("play_calling", 60) + r.get("player_development", 60) + r.get("recruiting", 60)) / 3


BIRTH_YEARS = Path(__file__).resolve().parents[1] / "data" / "coach_birth_years.json"
_BIRTHS: dict = {}


def _birth_years() -> dict:
    if not _BIRTHS and BIRTH_YEARS.exists():
        _BIRTHS.update(json.loads(BIRTH_YEARS.read_text(encoding="utf-8"))["birth_years"])
    return _BIRTHS


def _age(c: dict, year: int) -> int:
    """His age: from his real birth year (data/coach_birth_years.json, the 2026 head coaches)
    when we know it, else a seeded draw between 38 and 62."""
    if not c.get("age_at"):
        born = _birth_years().get(c.get("name"))
        c["age_at"] = [year, year - born] if born else [year, random.Random(f"age-{c.get('name')}").randint(38, 62)]
    y, a = c["age_at"]
    return a + (year - y)


def generated(rng: random.Random, lgd: dict, role: str, slug: str, year: int, like: Optional[dict] = None,
              level: float = 0.0) -> dict:
    """A coach for hire who is not in the league's jobs: ratings drawn like a random coach at that
    role, shifted by `level` (a candidate for a better job is better), scheme from `like`."""
    model = rng.choice([t["coaches"][role] for t in lgd["teams"].values() if t["coaches"].get(role)])
    base = json.loads(json.dumps(like or model))
    ratings = {k: int(max(30, min(95, v + rng.gauss(level - 2, 6)))) for k, v in model["ratings"].items()}
    base.update(name=recruits._name(rng, set()), ratings=ratings, since=year, coach_id=f"{slug}:{role}:{year}",
                previous_job=rng.choice(("NFL assistant", "Coordinator at an FCS program", "Assistant head coach",
                                         "Position coach", "Head coach at a lower level")),
                ratings_generated=True, age_at=[year, rng.randint(34, 55)])
    return base


# ----- the coaching market ----------------------------------------------------------------------

def _taken_names(lgd: dict) -> set[str]:
    names = {c["name"].lower() for t in lgd["teams"].values() for c in t["coaches"].values() if c and c.get("name")}
    names |= {c["name"].lower() for c in (lgd.get("market") or {}).get("coaches", [])}
    return names


def _ratings_for(lgd: dict, role: str, coach: dict, rng: random.Random, level: float = 0.0) -> dict:
    """A coach's ratings in `role`: his own when he has held it, else drawn like a coach at that
    role and shifted by `level`, keeping the shared ratings he already has."""
    own = (coach.get("ratings_by_role") or {}).get(role) or (coach.get("ratings") if coach.get("role") == role else None)
    if own:
        return dict(own)
    model = rng.choice([t["coaches"][role] for t in lgd["teams"].values() if t["coaches"].get(role)])
    ratings = {k: int(max(20, min(95, v + rng.gauss(level - 2, 6)))) for k, v in model["ratings"].items()}
    ratings.update({k: v for k, v in (coach.get("ratings") or {}).items() if k in ratings and k != "overall"})
    return ratings


def _entry(coach: dict, role: str, team: Optional[str], why: str, year: int, roles: list[str], rng: random.Random) -> dict:
    """A market entry for a coach who just left `role` at `team`."""
    hist = list(coach.get("history") or [])
    if team:
        hist.append({"year": coach.get("since") or year, "to": year, "team": team, "role": role})
    return {"id": f"m-{year}-{coach.get('name', 'x').lower().replace(' ', '-')}-{rng.randint(0, 9999)}",
            "name": coach["name"], "roles": roles, "last_role": role, "last_team": team, "why": why, "year": year,
            "age": _age(coach, year), "history": hist, "ratings": dict(coach.get("ratings") or {}),
            "ratings_by_role": dict(coach.get("ratings_by_role") or {}, **({role: dict(coach["ratings"])} if coach.get("ratings") else {})),
            "coach": {k: v for k, v in coach.items() if k not in ("ratings", "history", "ratings_by_role")}}


def market(state: dict) -> dict:
    """The coaches for hire: lgd["market"] = {"coaches": [entry], "year"}; built when first asked."""
    lgd = state["league"]
    if "market" not in lgd:
        lgd["market"] = {"coaches": [], "year": state.get("year", 2026)}
        market_refresh(state)
    return lgd["market"]


# where a generated coach for hire comes from: (roles he would take, previous job words, level shift, age range)
SUPPLY = (
    (["head_coach", "offensive_coordinator", "defensive_coordinator"], "Head coach at an FCS program", 0, (38, 58), 2),
    (["head_coach", "offensive_coordinator", "defensive_coordinator"], "Head coach at a Division II program", -4, (36, 56), 1),
    (["head_coach", "offensive_coordinator"], "NFL offensive assistant", 2, (34, 52), 2),
    (["head_coach", "defensive_coordinator"], "NFL defensive assistant", 2, (34, 52), 2),
    (["offensive_coordinator"], "Offensive coordinator at an FCS program", -2, (32, 50), 3),
    (["defensive_coordinator"], "Defensive coordinator at an FCS program", -2, (32, 50), 3),
    (["offensive_coordinator"], "Quarterbacks coach at a Power 4 program", 0, (32, 48), 3),
    (["offensive_coordinator"], "Offensive line coach", -1, (34, 54), 2),
    (["defensive_coordinator"], "Linebackers coach at a Power 4 program", 0, (32, 48), 3),
    (["defensive_coordinator"], "Secondary coach", -1, (33, 52), 2),
    (["offensive_coordinator", "defensive_coordinator"], "Assistant head coach at a Group of 5 program", 1, (38, 56), 2),
    (["head_coach"], "Former head coach, out of the game a year", -3, (48, 64), 1),
)


WHY_GENERATED = {"head_coach": ("Ready for a bigger job", "Wants back into college football", "Looking for his first FBS job",
                                "A winner at a lower level, ready to move up"),
                 "coordinator": ("Ready to call his own plays", "Wants a coordinator's job", "Looking for a step up",
                                 "Interviewing for coordinator jobs")}


def market_refresh(state: dict) -> None:
    """Each offseason: coaches too long in the market retire from it, and the supply is topped up
    with generated coaches (FCS and lower-division head coaches, NFL assistants, position coaches)."""
    lgd = state["league"]
    year = state["offseason"]["year"] if state.get("offseason") else state.get("year", 2026)
    mk = lgd.setdefault("market", {"coaches": [], "year": year})
    from coach_career.offseason import seed_key
    rng = random.Random(f"market-{seed_key(state)}-{year}")
    mk["coaches"] = [c for c in mk["coaches"] if year - c["year"] < MARKET_STALE and c["age"] + (year - c["year"]) < 66]
    weights = [w for *_, w in SUPPLY]
    taken = _taken_names(lgd)
    while len(mk["coaches"]) < MARKET_SIZE:
        roles, prev, level, ages, _ = rng.choices(SUPPLY, weights)[0]
        name = recruits._name(rng, taken)
        main = roles[0] if roles[0] != "head_coach" or len(roles) == 1 else rng.choice(roles)
        coach = {"name": name, "role": main, "previous_job": prev, "ratings_generated": True,
                 "age_at": [year, rng.randint(*ages)], "since": year - rng.randint(1, 4)}
        coach["ratings"] = _ratings_for(lgd, main, coach, rng, level + rng.gauss(SUPPLY_LEVEL, SUPPLY_SPREAD))   # the supply runs from bottom-tier to power-tier coaches
        why = rng.choice(WHY_GENERATED["head_coach" if "head_coach" in roles else "coordinator"])
        mk["coaches"].append(_entry(coach, main, None, why, year, roles, rng))
    mk["year"] = year


def market_add(state: dict, coach: dict, role: str, team: Optional[str], why: str, year: int,
               roles: Optional[list[str]] = None) -> dict:
    """A coach who lost or left his job joins the market (fired coaches sit out this offseason)."""
    mk = market(state)
    rng = random.Random(f"mk-{coach.get('name')}-{year}")
    if roles is None:
        roles = ["head_coach"] + list(COORD_ROLES) if role == "head_coach" else [role]
    e = _entry(coach, role, team, why, year, roles, rng)
    e["sits_out"] = year
    mk["coaches"].append(e)
    return e


def market_candidates(state: dict, slug: str, role: str, n: int, rng: Optional[random.Random] = None,
                      year: Optional[int] = None) -> list[tuple[float, dict]]:
    """The market's best `n` coaches for `role` at `slug`, (score, entry): his ratings for the role
    (drawn when he has not held it) against the program's level, a little noise."""
    mk = market(state)
    lgd = state["league"]
    year = year or mk["year"]
    from coach_career.offseason import seed_key
    rng = rng or random.Random(f"cands-{seed_key(state)}-{slug}-{role}-{year}")
    b = programs.z(state, slug)
    out = []
    level, ceiling = programs.coach_level(state, slug), programs.coach_ceiling(state, slug)
    for e in mk["coaches"]:
        if role not in e["roles"] or (e.get("sits_out") == year and (role == "head_coach" or e["last_role"] == "head_coach")):
            continue                                        # a fired head coach sits out the cycle; a let-go coordinator can land at once
        r = e["ratings_by_role"].get(role)
        if r is None:
            r = e["ratings_by_role"][role] = _ratings_for(lgd, role, {"ratings": e["ratings"], "role": e["last_role"]},
                                                          random.Random(f"rf-{e['id']}-{role}"), level)
        if _rating({"ratings": r}) > ceiling and role == "head_coach":
            continue                                        # a coach that good waits for a bigger job
        score = _rating({"ratings": r}) - (3 if e["last_role"] != role and role == "head_coach" else 0) + rng.gauss(0, 3)
        out.append((score, e))
    out.sort(key=lambda x: -x[0])
    return out[:n]


def market_take(state: dict, entry_id: str, role: str, slug: str, year: int) -> dict:
    """A market coach takes `role` at `slug`: out of the pool, a coach dict for the job."""
    mk = market(state)
    e = next((c for c in mk["coaches"] if c["id"] == entry_id), None)
    if e is None:
        raise ValueError("that coach is no longer available")
    mk["coaches"].remove(e)
    lgd = state["league"]
    ratings = e["ratings_by_role"].get(role) or _ratings_for(lgd, role, {"ratings": e["ratings"], "role": e["last_role"]},
                                                              random.Random(f"rf-{e['id']}-{role}"), 2 * programs.z(state, slug))
    like = lgd["teams"][slug]["coaches"].get(role) or next(t["coaches"][role] for t in lgd["teams"].values() if t["coaches"].get(role))
    coach = json.loads(json.dumps(like))
    coach.update(e["coach"], ratings=dict(ratings), role=role, team_slug=slug, since=year, coach_id=f"{slug}:{role}:{year}",
                 history=e["history"], ratings_by_role={k: v for k, v in e["ratings_by_role"].items() if k != role},
                 previous_job=_previous_job(e), is_interim=False)
    coach.pop("ratings_generated", None) if not e["coach"].get("ratings_generated") else None
    return coach


def _previous_job(e: dict) -> str:
    if e["last_team"]:
        return f"{ROLE_WORDS.get(e['last_role'], e['last_role'])} at {_name(e['last_team'])}"
    return e["why"]


def market_rows(state: dict, role: Optional[str] = None) -> list[dict]:
    """The market for the page: every coach for hire with why he is available and where he has been."""
    mk = market(state)
    rows = []
    for e in mk["coaches"]:
        if role and role not in e["roles"]:
            continue
        rows.append({"id": e["id"], "name": e["name"], "roles": [ROLE_WORDS[r] for r in e["roles"]], "age": e["age"] + (mk["year"] - e["year"]),
                     "why": e["why"], "previous_job": _previous_job(e), "rating": int(_rating({"ratings": e["ratings"]})),
                     "history": [dict(h, team_name=_name(h["team"])) for h in e["history"]],
                     "sits_out": e.get("sits_out") == mk["year"] and e["last_role"] == "head_coach"})
    rows.sort(key=lambda r: -r["rating"])
    return rows


def _fired_why(slug: str, res: dict) -> str:
    return f"Fired by {_name(slug)} after a {res.get('wins', 0)}-{res.get('losses', 0)} season"


def contract_holds(state: dict, role: str, year: int) -> bool:
    """Your coordinator in `role` is signed for the coming season and honors it this offseason:
    one seeded draw a year (its own stream, so the carousel's draws stand), he goes through at
    offseason.UNDER_CONTRACT. A member without a contract (an old save) is free to go."""
    from coach_career import offseason
    staff = (state.get("career") or {}).get("staff") or []
    s = next((x for x in staff if offseason.STAFF_ROLES.get(x["role"]) == role), None)
    if s is None or offseason.expiring(s, year):
        return False
    return random.Random(f"contract-{offseason.seed_key(state)}-{year}-{role}").random() >= offseason.UNDER_CONTRACT


def run(state: dict) -> dict:
    """The whole carousel for the offseason: verdicts, departures, the hiring chain, coordinators,
    your staff and your job. Returns the record shown on the Offseason screen."""
    from sim import season
    lgd = state["league"]
    year = state["offseason"]["year"]
    rng = _rng(state, "run")
    me = state["team"]
    res = _results(state)
    teams = season.load_teams()
    market(state)
    market_refresh(state)
    ad(lgd["teams"][me], me)                                    # you start on solid ground
    rv = state["offseason"].get("review")
    verdicts = {slug: (rv["verdict"] if rv and slug == me else judge(t, slug, res.get(slug, {"wins": 0, "losses": 0}), year, state))
                for slug, t in lgd["teams"].items()}
    from coach_career import programs
    programs.update(state, res, programs.final_ranks(state))
    for slug, t in lgd["teams"].items():                          # the AD's hand on the NIL tier
        r = res.get(slug, {"wins": 0, "losses": 0})
        programs.nil_move(t, met=verdicts[slug]["met"], losing=r["wins"] < r["losses"])
    changes, open_hc, left_hc = [], [], {}
    holds = {role: contract_holds(state, role, year) for role in COORD_ROLES}    # your coordinators under contract who stay put this year
    your_declined: dict[str, Optional[str]] = {}                                 # role -> the school he turned down (None: a bigger job in general)

    def leave(slug: str, reason: str, why: Optional[str] = None) -> None:
        t = lgd["teams"][slug]
        hc = t["coaches"]["head_coach"]
        changes.append({"team": slug, "role": "head_coach", "old": hc["name"], "reason": reason})
        open_hc.append(slug)
        left_hc[slug] = hc["name"]
        if why:
            market_add(state, hc, "head_coach", slug, why, year)

    # 1. who goes: fired, retired, NFL
    for slug, t in lgd["teams"].items():
        if slug == me:
            continue
        hc, v = t["coaches"]["head_coach"], verdicts[slug]
        sec = v["security"]
        r = res.get(slug, {})
        if (sec < FIRE_BELOW and v["tenure"] >= 2 and rng.random() < FIRE_CHANCE) or sec < MUST_FIRE:
            leave(slug, "fired", _fired_why(slug, r))
        elif _rating(hc) >= 80 and r.get("wins", 0) >= 10 and rng.random() < NFL_CHANCE:
            leave(slug, "left for the NFL")
        elif rng.random() < RETIRE * (1 + max(0, v["tenure"] - 12) / 8) * (1 + max(0, _age(hc, year) - 60) / 5):
            leave(slug, "retired")
    you = verdicts.get(me, {})
    if rv:                                                       # decided in your meeting with the AD
        fired_you = bool(rv.get("fired"))
        you = dict(you, security=rv["security"])
    else:
        fired_you = you and ((you["security"] < FIRE_BELOW and you["tenure"] >= 2 and rng.random() < FIRE_CHANCE) or you["security"] < MUST_FIRE)
    if fired_you:
        changes.append({"team": me, "role": "head_coach", "old": lgd["teams"][me]["coaches"]["head_coach"]["name"], "reason": "fired"})
    # 2. fill the openings, best programs first; a hire can open another job
    filled: dict[str, dict] = {}
    queue = sorted(open_hc, key=lambda s: -attract(state, s))
    open_coords: list[tuple[str, str, str]] = []            # (team, role, reason) coordinator jobs to fill
    taken: set[str] = set(left_hc.values())                  # coaches gone or hired away this offseason
    guard = 0
    while queue and guard < 400:
        guard += 1
        slug = queue.pop(0)
        declined: list[dict] = []
        hire, src = _pick_head_coach(state, slug, verdicts, res, filled, rng, year, taken, holds, declined)
        for d in declined:                                    # your coordinator turned the job down: under contract
            your_declined[d["role"]] = teams[slug]["name"]
        taken.add(hire["name"])
        lgd["teams"][slug]["coaches"]["head_coach"] = hire
        lgd["teams"][slug]["style"] = new_style(rng, lgd, slug)
        lgd["teams"][slug].setdefault("ad", ad(lgd["teams"][slug], slug))["security"] = START_SECURITY
        filled[slug] = hire
        changes.append({"team": slug, "role": "head_coach", "new": hire["name"], "reason": "hired", "from": src.get("text"),
                        "from_market": src.get("kind") == "market", "tier": programs.get(state, slug)["tier"]})
        if src.get("kind") == "head_coach":
            changes.append({"team": src["team"], "role": "head_coach", "old": hire["name"], "reason": f"left for {teams[slug]['name']}"})
            left_hc[src["team"]] = hire["name"]                  # so a coordinator slot he held himself opens as "left", not "let go" into the market
            queue.append(src["team"])
            queue.sort(key=lambda s: -attract(state, s))
        elif src.get("kind") == "coordinator":
            changes.append({"team": src["team"], "role": src["role"], "old": hire["name"], "reason": f"left for {teams[slug]['name']}"})
            open_coords.append((src["team"], src["role"], "poached"))
    # 3. coordinators: hired away, let go by a new head coach, leaving on their own; filled from the market
    for slug, t in lgd["teams"].items():
        for role in COORD_ROLES:
            if any(s == slug and r == role for s, r, _ in open_coords):
                continue
            c = t["coaches"].get(role)
            if not (c and c.get("name")):
                continue
            if c["name"] == left_hc.get(slug):                   # the head coach called his own plays
                open_coords.append((slug, role, "left"))
            elif c["name"] == t["coaches"]["head_coach"].get("name"):
                continue
            elif slug in filled and slug != me and rng.random() < OWN_STAFF:
                changes.append({"team": slug, "role": role, "old": c["name"], "reason": "let go"})
                market_add(state, c, role, slug, f"Let go at {_name(slug)} when {filled[slug]['name']} brought his own staff", year)
                open_coords.append((slug, role, "let go"))
            elif rng.random() < COORD_MOVE:                      # yours too: a coordinator looks for a bigger job
                if slug == me and holds.get(role):                # ... unless he is yours and honors his contract this year
                    your_declined.setdefault(role, None)
                    continue
                changes.append({"team": slug, "role": role, "old": c["name"], "reason": "moved on"})
                market_add(state, c, role, slug, f"Left {_name(slug)} after {year - (c.get('since') or year)} seasons to look for a bigger job", year)
                open_coords.append((slug, role, "moved on"))
    your_poached, your_poached_why = [], {}
    for slug, role, reason in sorted(open_coords, key=lambda x: -attract(state, x[0])):
        if slug == me:                                            # your opening waits for you at the Staff step
            your_poached.append(role)
            c = lgd["teams"][me]["coaches"].get(role)
            if c:                                                 # he is gone: the slot is vacant until you fill it (a new dict: his record may now be another team's head coach)
                lgd["teams"][me]["coaches"][role] = {**c, "name": "", "vacant": True}
            went = next((c for c in changes if c["team"] == me and c["role"] == role and c.get("old") and c["reason"].startswith("left for")), None)
            your_poached_why[role] = (f"was hired away as the head coach at {went['reason'][len('left for '):]}" if went
                                      else "left to look for a bigger job" if reason == "moved on" else "is moving on")
            continue
        hire, src = _pick_coordinator(state, slug, role, rng, year)
        lgd["teams"][slug]["coaches"][role] = hire
        changes.append({"team": slug, "role": role, "new": hire["name"], "reason": "hired", "from": src, "from_market": True})
    # 4. your job: offers after a great year; a pick of openings if fired
    offers = []
    my_a = attract(state, me)
    if you and not fired_you and you["security"] >= OFFER_FROM:
        better = [s for s in open_hc + list(filled) if s != me and attract(state, s) >= my_a + MOVE_UP]
        offers = sorted(set(better), key=lambda s: -attract(state, s))[:3]
    openings = []
    if fired_you:
        lower = sorted({s for s in open_hc + list(filled) if s != me}, key=lambda s: -attract(state, s))
        openings = [s for s in lower if attract(state, s) <= my_a][:FIRED_PICKS] or lower[-FIRED_PICKS:]
    return {"changes": changes, "you": dict(you, fired=bool(fired_you)) if you else {}, "offers": offers, "openings": openings,
            "choice": None, "poached": your_poached, "poached_why": your_poached_why, "declined": your_declined, "verdicts": {s: {"security": v["security"], "met": v["met"], "goal": v["goal"]["text"]}
                                                                for s, v in verdicts.items()}}


def _pick_coordinator(state: dict, slug: str, role: str, rng: random.Random, year: int) -> tuple[dict, str]:
    """The market's best coordinator for the job (one is generated when the market has none)."""
    cands = market_candidates(state, slug, role, 3, rng, year)
    if not cands:
        lgd = state["league"]
        g = generated(rng, lgd, role, slug, year, like=lgd["teams"][slug]["coaches"].get(role), level=programs.coach_level(state, slug))
        return g, g["previous_job"]
    e = cands[0][1]
    return market_take(state, e["id"], role, slug, year), _previous_job(e)


def _pick_head_coach(state: dict, slug: str, verdicts: dict, res: dict, filled: dict, rng: random.Random, year: int,
                     taken: Optional[set] = None, holds: Optional[dict] = None, declined: Optional[list] = None) -> tuple[dict, dict]:
    """The best candidate who would take the job: a sitting head coach at a smaller program with a
    winning run, a coordinator at a strong program, or one of the market's best three. Your
    coordinator under contract who honors it (`holds[role]`) turns the job down when he is the
    pick (noted in `declined`) and the next best takes it."""
    lgd = state["league"]
    me = state["team"]
    b = programs.z(state, slug)
    a = attract(state, slug)
    hist = (state.get("career") or {}).get("league_records", {})
    cands = []
    taken = taken or set()
    for s, t in lgd["teams"].items():
        if s == slug or s in filled:
            continue
        hc = t["coaches"]["head_coach"]
        recs = hist.get(s, [])[-2:] + [[res.get(s, {}).get("wins", 0), res.get(s, {}).get("losses", 0)]]
        w = sum(r[0] for r in recs)
        pct = w / max(1, sum(r[0] + r[1] for r in recs))
        # you are never hired away behind your back (your offers come in step 4); your coordinators are fair game
        if s != me and hc["name"] not in taken and attract(state, s) + MOVE_UP <= a and pct >= HC_MOVE_PCT and verdicts[s]["tenure"] >= 2:
            cands.append((_rating(hc) + HC_PROVEN + 20 * (pct - HC_MOVE_PCT) + rng.gauss(0, 3), hc, {"kind": "head_coach", "team": s,
                          "text": f"head coach at {_name(s)}"}))
        for role in COORD_ROLES:
            c = t["coaches"].get(role)
            if c and c.get("name") and c["name"] not in taken and c["name"] != hc["name"] and attract(state, s) >= a + COORD_UP and res.get(s, {}).get("wins", 0) >= 9:
                cands.append((_rating(c) - 4 + rng.gauss(0, 3), c, {"kind": "coordinator", "team": s, "role": role,
                              "text": f"{ROLE_WORDS[role]} at {_name(s)}"}))
    for score, e in market_candidates(state, slug, "head_coach", 3, rng, year):
        cands.append((score - 2, e, {"kind": "market", "text": _previous_job(e), "id": e["id"]}))
    if not cands:
        g = generated(rng, lgd, "head_coach", slug, year, level=programs.coach_level(state, slug))
        cands.append((0, g, {"kind": "generated", "text": g["previous_job"]}))
    cands.sort(key=lambda x: -x[0])
    score, pick, src = cands[0]
    for score, pick, src in cands:
        if src["kind"] == "coordinator" and src["team"] == me and (holds or {}).get(src["role"]):
            if declined is not None:
                declined.append({"role": src["role"], "name": pick["name"]})
            continue
        break
    if src["kind"] == "market":
        return market_take(state, src["id"], "head_coach", slug, year), src
    hire = json.loads(json.dumps(pick))
    if src["kind"] == "coordinator":                    # a coordinator becomes a head coach: head coach ratings
        g = generated(random.Random(f"{slug}-{pick.get('name')}"), lgd, "head_coach", slug, year, level=programs.coach_level(state, slug))
        g["ratings"].update({k: v for k, v in pick.get("ratings", {}).items() if k in g["ratings"]})
        g["name"] = pick["name"]
        g["age_at"] = pick.get("age_at")
        g["ratings_by_role"] = {src["role"]: dict(pick["ratings"])}
        hire = g
    hist = list(pick.get("history") or []) + [{"year": pick.get("since") or year, "to": year, "team": src["team"],
                                               "role": src.get("role", "head_coach")}]
    hire.update(since=year, previous_job=src["text"], history=hist, team_slug=slug, coach_id=f"{slug}:head_coach:{year}")
    return hire, src


def _name(slug: str) -> str:
    from sim import season
    return season.load_teams()[slug]["name"]


def mood(sec: int) -> str:
    return "Untouchable" if sec >= 90 else "Secure" if sec >= 65 else "Warm Seat" if sec >= 40 else "Hot Seat"


def status(state: dict) -> dict:
    """Your job for the page: the AD's goal, your security, his patience and any ultimatum."""
    me = state["team"]
    lgd = state.get("league") or {}
    t = (lgd.get("teams") or {}).get(me)
    a = ad(t, me) if t else {"patience": None, "security": START_SECURITY}
    g = goal(me, state)
    sec = a["security"]
    year = state.get("year", 2026)
    return {"goal": g["text"], "security": sec, "patience": a.get("patience"), "mood": mood(sec),
            "ultimatum": (a.get("ultimatum") or 0) >= year}


def job_rows(state: dict, slugs: list[str]) -> list[dict]:
    from sim import season
    teams = season.load_teams()
    return [{"team": s, "name": teams[s]["name"], "conference": teams[s]["conference"], "goal": goal(s, state)["text"],
             "tier": programs.get(state, s)["tier"], "program_rating": programs.get(state, s)["rating"],
             "rating": teams[s]["team_ratings"]["overall"]} for s in slugs]
