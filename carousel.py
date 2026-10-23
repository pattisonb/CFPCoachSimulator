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
from typing import Optional

import recruits

# goals, by the program's recruiting baseline (about -2 to +2): (from, kind, wins, words) *tune*
GOALS = ((1.2, "playoff", 10, "Make the College Football Playoff"), (0.5, "wins", 9, "Win nine games"),
         (-0.3, "wins", 7, "Win seven games and go bowling"), (-10, "wins", 6, "Reach a bowl game"))
G5_TITLE_FROM = 0.0              # a Group of 5 program this strong expects to win its conference
START_SECURITY = 70
HONEYMOON = 2                    # a new coach's first seasons count half against him
WIN_STEP = 8                     # security per win over or under the goal
BONUS = {"conference": 10, "playoff": 12, "title": 25}
FIRE_BELOW, FIRE_CHANCE, MUST_FIRE = 25, 0.75, 8
RETIRE = 0.03                    # a year, more after 12 seasons in the job and past 60 (an age drawn when unknown)
NFL_CHANCE = 0.10                # a 85+ head coach after 11 wins; coordinators 0.06 after a top-10 unit
COORD_MOVE = 0.10                # coordinators leaving for other jobs on their own
OFFER_FROM = 80                  # your security this high, and better programs with an opening call
FIRED_PICKS = 6                  # openings offered to you after you are fired (the lower ones)


def _rng(state: dict, what: str) -> random.Random:
    return random.Random(f"carousel-{state['id']}-{state.get('year', 2026)}-{what}")


def baseline(slug: str) -> float:
    import recruiting
    return recruiting._baseline(slug)


def goal(slug: str) -> dict:
    """What the AD expects every year."""
    import season
    b = baseline(slug)
    p4 = season._is_p4(slug, season.load_teams()[slug])
    if not p4 and b >= G5_TITLE_FROM:
        return {"kind": "conference", "wins": 10, "text": "Win the conference"}
    for frm, kind, wins, text in GOALS:
        if b >= frm:
            return {"kind": kind, "wins": wins, "text": text}
    return {"kind": "wins", "wins": 6, "text": "Reach a bowl game"}


def ad(team: dict, slug: str) -> dict:
    """The program's AD (patience fixed per program, drawn once) and the head coach's security."""
    if "ad" not in team:
        r = random.Random(f"ad-{slug}")
        b = baseline(slug)
        base = 2 if b >= 1.2 else 3 if b >= 0.3 else 4
        team["ad"] = {"patience": max(2, min(5, base + r.choice((-1, 0, 0, 1)))), "security": START_SECURITY}
    return team["ad"]


def _results(state: dict) -> dict[str, dict]:
    """Each program's season: wins, losses, conference title, playoff, national title."""
    import season
    recs = season._records(state, include_playoff=True)
    playoff = {g[s] for g in state["games"].values() if g.get("kind") == "playoff" for s in ("home", "away")}
    champs = set((state.get("champions") or {}).values())
    return {slug: {"wins": r["wins"], "losses": r["losses"], "conference": slug in champs, "playoff": slug in playoff,
                   "title": state.get("champion") == slug} for slug, r in recs.items()}


def judge(team: dict, slug: str, res: dict, year: int) -> dict:
    """The AD's verdict on a season: security moves with wins against the goal and the honours."""
    a = ad(team, slug)
    g = goal(slug)
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
    import build_teams
    obs = json.loads(build_teams.OBSERVED.read_text(encoding="utf-8"))["teams"] if build_teams.OBSERVED.exists() else {}
    pool = sorted(s for s, o in obs.items() if o.get("games", 0) >= 2 and s != slug)
    return rng.choice(pool) if pool else slug


def _rating(c: dict) -> float:
    r = c.get("ratings") or {}
    return r.get("overall") or (r.get("play_calling", 60) + r.get("player_development", 60) + r.get("recruiting", 60)) / 3


def _age(c: dict, year: int) -> int:
    if not c.get("age_at"):
        c["age_at"] = [year, random.Random(f"age-{c.get('name')}").randint(38, 62)]
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


def run(state: dict) -> dict:
    """The whole carousel for the offseason: verdicts, departures, the hiring chain, coordinators,
    your staff and your job. Returns the record shown on the Offseason screen."""
    import season
    lgd = state["league"]
    year = state["offseason"]["year"]
    rng = _rng(state, "run")
    me = state["team"]
    res = _results(state)
    teams = season.load_teams()
    verdicts = {slug: judge(t, slug, res.get(slug, {"wins": 0, "losses": 0}), year) for slug, t in lgd["teams"].items()}
    changes, open_hc = [], []

    def leave(slug: str, reason: str) -> None:
        t = lgd["teams"][slug]
        changes.append({"team": slug, "role": "head_coach", "old": t["coaches"]["head_coach"]["name"], "reason": reason})
        open_hc.append(slug)

    # 1. who goes: fired, retired, NFL
    for slug, t in lgd["teams"].items():
        if slug == me:
            continue
        hc, v = t["coaches"]["head_coach"], verdicts[slug]
        sec = v["security"]
        r = res.get(slug, {})
        if (sec < FIRE_BELOW and v["tenure"] >= 2 and rng.random() < FIRE_CHANCE) or sec < MUST_FIRE:
            leave(slug, "fired")
        elif _rating(hc) >= 85 and r.get("wins", 0) >= 11 and rng.random() < NFL_CHANCE:
            leave(slug, "left for the NFL")
        elif rng.random() < RETIRE * (1 + max(0, v["tenure"] - 12) / 8) * (1 + max(0, _age(hc, year) - 60) / 5):
            leave(slug, "retired")
    you = verdicts.get(me, {})
    fired_you = you and ((you["security"] < FIRE_BELOW and you["tenure"] >= 2 and rng.random() < FIRE_CHANCE) or you["security"] < MUST_FIRE)
    # 2. fill the openings, best programs first; a hire can open another job
    filled: dict[str, dict] = {}
    queue = sorted(open_hc, key=lambda s: -baseline(s))
    poached_coords: list[tuple[str, str]] = []
    guard = 0
    while queue and guard < 400:
        guard += 1
        slug = queue.pop(0)
        hire, src = _pick_head_coach(state, slug, verdicts, res, filled, rng, year)
        lgd["teams"][slug]["coaches"]["head_coach"] = hire
        lgd["teams"][slug]["style"] = new_style(rng, lgd, slug)
        lgd["teams"][slug].setdefault("ad", ad(lgd["teams"][slug], slug))["security"] = START_SECURITY
        filled[slug] = hire
        changes.append({"team": slug, "role": "head_coach", "new": hire["name"], "reason": "hired", "from": src.get("text")})
        if src.get("kind") == "head_coach":
            changes.append({"team": src["team"], "role": "head_coach", "old": hire["name"], "reason": f"left for {teams[slug]['name']}"})
            queue.append(src["team"])
            queue.sort(key=lambda s: -baseline(s))
        elif src.get("kind") == "coordinator":
            poached_coords.append((src["team"], src["role"]))
    # 3. coordinators: the ones hired away, a few leaving on their own; generated replacements
    for slug, t in lgd["teams"].items():
        for role in ("offensive_coordinator", "defensive_coordinator"):
            gone = (slug, role) in poached_coords
            if not gone and slug != me and slug not in filled and rng.random() < COORD_MOVE:
                gone = True
                changes.append({"team": slug, "role": role, "old": (t["coaches"].get(role) or {}).get("name"), "reason": "moved on"})
            if gone and slug != me:
                level = 3 * baseline(slug)
                t["coaches"][role] = generated(rng, lgd, role, slug, year, like=t["coaches"].get(role), level=level)
                changes.append({"team": slug, "role": role, "new": t["coaches"][role]["name"], "reason": "hired"})
            elif slug in filled and rng.random() < 0.5 and slug != me:
                # a new head coach brings his own coordinator half the time
                t["coaches"][role] = generated(rng, lgd, role, slug, year, like=t["coaches"].get(role), level=2 * baseline(slug))
    your_poached = [role for s, role in poached_coords if s == me]
    # 4. your job: offers after a great year; a pick of openings if fired
    offers = []
    my_b = baseline(me)
    if you and not fired_you and you["security"] >= OFFER_FROM:
        better = [s for s in open_hc + list(filled) if s != me and baseline(s) > my_b + 0.3]
        offers = sorted(set(better), key=lambda s: -baseline(s))[:3]
    openings = []
    if fired_you:
        lower = sorted({s for s in open_hc + list(filled) if s != me}, key=lambda s: -baseline(s))
        openings = [s for s in lower if baseline(s) <= my_b][:FIRED_PICKS] or lower[-FIRED_PICKS:]
    return {"changes": changes, "you": dict(you, fired=bool(fired_you)) if you else {}, "offers": offers, "openings": openings,
            "choice": None, "poached": your_poached, "verdicts": {s: {"security": v["security"], "met": v["met"], "goal": v["goal"]["text"]}
                                                                for s, v in verdicts.items()}}


def _pick_head_coach(state: dict, slug: str, verdicts: dict, res: dict, filled: dict, rng: random.Random, year: int) -> tuple[dict, dict]:
    """The best candidate who would take the job: a sitting head coach at a smaller program with a
    winning run, a coordinator at a strong program, or one of three generated candidates."""
    lgd = state["league"]
    me = state["team"]
    b = baseline(slug)
    hist = (state.get("career") or {}).get("league_records", {})
    cands = []
    for s, t in lgd["teams"].items():
        if s in (slug, me) or s in filled:
            continue
        hc = t["coaches"]["head_coach"]
        recs = hist.get(s, [])[-2:] + [[res.get(s, {}).get("wins", 0), res.get(s, {}).get("losses", 0)]]
        w = sum(r[0] for r in recs)
        pct = w / max(1, sum(r[0] + r[1] for r in recs))
        if baseline(s) < b - 0.3 and pct >= 0.65 and verdicts[s]["tenure"] >= 2:
            cands.append((_rating(hc) + 20 * (pct - 0.65) + rng.gauss(0, 3), hc, {"kind": "head_coach", "team": s,
                          "text": f"head coach at {_name(s)}"}))
        for role in ("offensive_coordinator", "defensive_coordinator"):
            c = t["coaches"].get(role)
            if c and baseline(s) >= b - 0.5 and res.get(s, {}).get("wins", 0) >= 9:
                cands.append((_rating(c) - 4 + rng.gauss(0, 3), c, {"kind": "coordinator", "team": s, "role": role,
                              "text": f"{'offensive' if role.startswith('off') else 'defensive'} coordinator at {_name(s)}"}))
    for _ in range(3):
        g = generated(rng, lgd, "head_coach", slug, year, level=2 * b)
        cands.append((_rating(g) - 2 + rng.gauss(0, 3), g, {"kind": "generated", "text": g["previous_job"]}))
    score, pick, src = max(cands, key=lambda x: x[0])
    hire = json.loads(json.dumps(pick))
    if src["kind"] == "coordinator":                    # a coordinator becomes a head coach: head coach ratings
        g = generated(random.Random(f"{slug}-{pick.get('name')}"), lgd, "head_coach", slug, year, level=2 * b)
        g["ratings"].update({k: v for k, v in pick.get("ratings", {}).items() if k in g["ratings"]})
        g["name"] = pick["name"]
        hire = g
    hire.update(since=year, previous_job=src["text"])
    return hire, src


def _name(slug: str) -> str:
    import season
    return season.load_teams()[slug]["name"]


def status(state: dict) -> dict:
    """Your job for the page: the AD's goal, your security and his patience."""
    me = state["team"]
    lgd = state.get("league") or {}
    t = (lgd.get("teams") or {}).get(me)
    a = ad(t, me) if t else {"patience": None, "security": START_SECURITY}
    g = goal(me)
    sec = a["security"]
    return {"goal": g["text"], "security": sec, "patience": a.get("patience"),
            "mood": "Untouchable" if sec >= 90 else "Secure" if sec >= 65 else "Warm seat" if sec >= 40 else "Hot seat"}


def job_rows(state: dict, slugs: list[str]) -> list[dict]:
    import season
    teams = season.load_teams()
    return [{"team": s, "name": teams[s]["name"], "conference": teams[s]["conference"], "goal": goal(s)["text"],
             "rating": teams[s]["team_ratings"]["overall"]} for s in slugs]
