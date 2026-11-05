"""One coach, one name, one job (a career's league). The real 2026 data lists a head coach who
calls his own plays twice: as the head coach and again as the offensive coordinator, under the
same name (North Texas: Neal Brown both times). A career keeps people apart:

- **A head coach never doubles as his own coordinator.** The coordinator's slot keeps its
  ratings, scheme and id but is a different man: a generated name, the same one every time for
  that program and role (`own_name`), so your staff on day one and the league built after the
  season agree.
- **Your name wins.** Whatever you call your coach (or the real head coach you took over as),
  nobody else in the league has that name.
- **Any other two coaches with one name:** a real coach (one in the 2026 data) keeps his own
  record and gains a middle initial ("Tim Beck" -> "Tim R. Beck"); a generated coach is renamed
  from the generated pool (recruits._name, checked against every name in use).

`distinct(state)` applies all of it to a career (its league, its market and your staff); it is
deterministic and idempotent, so it runs when the league is built and on every load (an older
save heals). Its draws are its own seeded streams: nothing in the season or the carousel moves.
"""
from __future__ import annotations

import random
from typing import Optional

from coach_career import recruits

ROLES = ("head_coach", "offensive_coordinator", "defensive_coordinator")
COORDS = {"OC": "offensive_coordinator", "DC": "defensive_coordinator"}
INITIALS = "ABCDEFGHJKLMNPRSTW"      # middle initials a renamed real coach may get *tune*
OWN_STAFF_JOB = "Promoted from the staff"   # the previous job of a coordinator split off a play-calling head coach


def base_names() -> set[str]:
    """Every coach name in the 2026 data (lowercase): the real coaches."""
    from sim import season
    return {c["name"].lower() for t in season.load_teams().values()
            for c in (t.get("coaches") or {}).values() if c and c.get("name")}


def own_name(slug: str, role: str, reserved: set[str] = frozenset()) -> str:
    """The coordinator at `slug` in `role` when the data's coordinator is the head coach himself:
    a generated name, fixed per program and role (`reserved`, lowercase, are names it must avoid
    besides the real coaches')."""
    rng = random.Random(f"own-staff-{slug}-{role}")
    return recruits._name(rng, base_names() | {n.lower() for n in reserved})


def with_initial(name: str, taken: set[str], where: str) -> str:
    """`name` with a middle initial no one else has ("Neal Brown" -> "Neal R. Brown")."""
    first, _, rest = name.partition(" ")
    letters = list(INITIALS)
    random.Random(f"initial-{name}-{where}").shuffle(letters)
    for letter in letters:
        n = f"{first} {letter}. {rest}" if rest else f"{first} {letter}."
        if n.lower() not in taken:
            return n
    return recruits._name(random.Random(f"initial-x-{name}-{where}"), set(taken))


def _you_slug(state: dict) -> Optional[str]:
    """The program whose head coaching job is yours in the league: your next school once you have
    taken a job this offseason, else your team."""
    off = state.get("offseason") or {}
    return off.get("move_to") or state.get("team")


def your_record(state: dict) -> Optional[dict]:
    """Your coach's record in the career's league (marked `you`; an older save: the head coach at
    your program), or None before the league is built."""
    lgd = state.get("league") or {}
    teams = lgd.get("teams") or {}
    for slug in sorted(teams):
        hc = (teams[slug].get("coaches") or {}).get("head_coach")
        if hc and hc.get("you"):
            return hc
    slug = _you_slug(state)
    hc = ((teams.get(slug) or {}).get("coaches") or {}).get("head_coach") if slug else None
    return hc or None


def player_name(state: dict) -> Optional[str]:
    """Your coach's name: the coach you created, else the real head coach you took over as."""
    you = (state.get("career") or {}).get("coach")
    if you and you.get("name"):
        return you["name"]
    rec = your_record(state)
    if rec and rec.get("name"):
        return rec["name"]
    from sim import season
    t = season.load_teams().get(state.get("team")) or {}
    return ((t.get("coaches") or {}).get("head_coach") or {}).get("name")


def _claim_your_record(state: dict) -> None:
    """Mark your record in the league as yours and give it your created coach's name and age (the
    league is built from the 2026 data, so until now it held the head coach you replaced)."""
    rec = your_record(state)
    if rec is None:
        return
    rec["you"] = True
    you = (state.get("career") or {}).get("coach")
    if you and you.get("name") and not str(rec.get("coach_id") or "").endswith(":you"):
        slug = _you_slug(state)
        rec["name"] = you["name"]
        rec["coach_id"] = f"{slug}:head_coach:you"
        for k in ("history", "alma_mater", "age_at"):          # the replaced coach's, not yours
            rec.pop(k, None)
        age = (state.get("coach") or {}).get("age")
        if age:
            rec["age_at"] = [2026, int(age)]


def distinct(state: dict, built: bool = False) -> list[dict]:
    """Make every name in a career unique and every role its own person (the rules above). Returns
    the renames, [{"team", "role", "old", "new"}] (team None: the market). Your staff follows its
    coordinators' renames. Safe to run any number of times."""
    from coach_career import carousel
    lgd = state.get("league")
    renames: list[dict] = []
    year = (state.get("offseason") or {}).get("year") or (lgd or {}).get("year") or state.get("year") or 2026
    real = base_names()
    if lgd:
        _claim_your_record(state)
        you = your_record(state)
        mine = player_name(state)
        reserved = {mine.lower()} if mine else set()

        created = bool((state.get("career") or {}).get("coach"))
        # 1. a head coach who is also listed as his own coordinator: the coordinator is a new man
        #    (not under a coach you created: the real coach you replaced stays on as coordinator, step 2)
        for slug in sorted(lgd["teams"]):
            cs = lgd["teams"][slug]["coaches"]
            if created and (cs.get("head_coach") or {}).get("you"):
                continue
            hc = (cs.get("head_coach") or {}).get("name")
            for role in ROLES[1:]:
                c = cs.get(role)
                if hc and c and c.get("name") and c["name"].lower() == hc.lower():
                    renames.append({"team": slug, "role": role, "old": c["name"], "new": None})
                    c["name"] = own_name(slug, role, reserved)
                    renames[-1]["new"] = c["name"]
                    c["previous_job"] = OWN_STAFF_JOB
                    c.pop("age_at", None)
                    c.pop("plays_called_by_hc", None)
        # 2. everyone else: your name first, then the real coaches, then the generated ones
        entries = []
        for slug in sorted(lgd["teams"]):
            for role in ROLES:
                c = lgd["teams"][slug]["coaches"].get(role)
                if c and c.get("name"):
                    entries.append((c is not you, c["name"].lower() not in real, slug, role, c))
        for e in sorted((lgd.get("market") or {}).get("coaches", []), key=lambda e: e["id"]):
            entries.append((True, e["name"].lower() not in real, None, e["id"], e))
        entries.sort(key=lambda x: (x[0], x[1]))           # stable: within a group, the order above
        every = {x[4]["name"].lower() for x in entries}
        seen: set[str] = set()
        for not_you, generated, slug, role, c in entries:
            key = c["name"].lower()
            if key in seen:
                if generated:
                    new = recruits._name(random.Random(f"rename-{slug}-{role}-{c['name']}"), seen | every | real)
                else:
                    if not c.get("age_at") and slug is not None:
                        carousel._age(c, year)
                    new = with_initial(c["name"], seen | every, f"{slug}-{role}")
                renames.append({"team": slug, "role": role if slug else None, "old": c["name"], "new": new})
                c["name"] = new
                if slug is None and isinstance(c.get("coach"), dict):
                    c["coach"]["name"] = new
                key = new.lower()
                every.add(key)
            seen.add(key)
        # 3. one record, one id
        ids: set[str] = set()
        for slug in sorted(lgd["teams"]):
            for role in ROLES:
                c = lgd["teams"][slug]["coaches"].get(role)
                if not c:
                    continue
                cid = c.get("coach_id") or f"{slug}:{role}"
                n = 2
                while cid in ids:
                    cid = f"{c.get('coach_id') or f'{slug}:{role}'}:{n}"
                    n += 1
                c["coach_id"] = cid
                ids.add(cid)
    _staff(state, renames, built)
    return renames


def coordinator_name(slug: str, role: str, name: str, hc_name: Optional[str], created: bool) -> str:
    """Your coordinator's name on day one (recruiting.make_staff, before the league exists), from
    the data's `name` for him: the data's head coach doubling as coordinator becomes his own man
    (`own_name`); a real coordinator who shares the name of the coach you created gains a middle
    initial. The league built after the season gives him the same name (`distinct`)."""
    if not name or not hc_name or name.lower() != hc_name.lower():
        return name
    if created:
        return with_initial(name, base_names() | {hc_name.lower()}, f"{slug}-{role}")
    return own_name(slug, role, {hc_name})


def _staff(state: dict, renames: list[dict], built: bool = False) -> None:
    """Your staff after the league's renames: a coordinator follows his record (`built`: the league
    was just made from the data your staff was made from, so he takes his record's name outright);
    no one on it shares your name or a colleague's, no recruiter a coach's elsewhere, and every
    member has his own id."""
    car = state.get("career") or {}
    staff = car.get("staff")
    if not staff:
        return
    lgd = state.get("league") or {}
    me = state.get("team")
    mine = player_name(state) or ""
    cs = ((lgd.get("teams") or {}).get(me) or {}).get("coaches") or {}
    for s in staff:
        key = COORDS.get(s["role"])
        if not key:
            continue
        rec = cs.get(key) or {}
        if built and rec.get("name") and not rec.get("vacant"):
            s["name"] = rec["name"]
            continue
        for r in renames:
            if r["team"] == me and r["role"] == key and s["name"] == r["old"]:
                s["name"] = r["new"]
        if not lgd:
            s["name"] = coordinator_name(me, key, s["name"], mine, bool(car.get("coach")))
    coach_names = {c["name"].lower() for t in (lgd.get("teams") or {}).values()
                   for c in (t.get("coaches") or {}).values() if c and c.get("name")}
    coach_names |= {e["name"].lower() for e in (lgd.get("market") or {}).get("coaches", [])}
    seen = {mine.lower()} if mine else set()
    ids: set[str] = set()
    for s in staff:
        key = s["name"].lower()
        if key in seen or (s["role"] not in COORDS and key in coach_names):
            s["name"] = recruits._name(random.Random(f"staff-name-{me}-{s['id']}-{s['name']}"), seen | coach_names | base_names())
        seen.add(s["name"].lower())
        sid, n = s["id"], 2
        while s["id"] in ids:
            s["id"] = f"{sid}-{n}"
            n += 1
        ids.add(s["id"])
