"""Keeps His Word: your coach's reputation for keeping promises (docs/superpowers/specs/2026-11-10-promises-expansion-
design.md, section 1). It lives on state["career"]["word"], so it follows you to a new job. Kept promises raise it,
broken ones cost more, and the broken player's position remembers it on top. Each offseason it drifts back toward
neutral. Recruits read it when you promise; below FLOOR they do not believe you. Only your coach has one (AI coaches
make no promises), and it never draws randomness, so the golden sim is untouched. Shown in words, never a number."""
from __future__ import annotations

from typing import Optional

WORD_START = 70                                   # *tune* where a new coach's word starts (Strong)
GAIN = {"kept": 3, "money_kept": 2, "package_kept": 2}   # *tune* what a kept promise adds
COST = {"bent": 2, "broken": 8, "money_broken": 5, "package_broken": 5, "recruit_broken": 5}   # *tune* what a broken one costs
STAR_COST = 1.5                                   # *tune* a broken promise to a starter-level player or a four-star-plus recruit costs this much more
GUARDED_COST = 1.5                                # *tune* a Guarded player's broken promise costs this much more
GROUP_EXTRA = 1.0                                 # *tune* the broken player's position takes the same delta again, times this
RECOVER = 0.25                                    # *tune* each offseason the overall moves this share back toward WORD_START
GROUP_DECAY = 0.5                                 # *tune* each offseason a position's extra is multiplied by this
FLOOR = 35                                        # *tune* below this a recruit does not believe a promise
PROMISE_MULT = (0.5, 1.5)                         # *tune* a believed promise's points run from this at 0 to this at 100
CARES_MORE = 1.5                                  # *tune* a Guarded recruit, or one whose decider is playing time, reads the word this much harder
STAR_OVR = 70                                     # *tune* a house overall this high makes a transfer a star for STAR_COST
LOG_KEEP = 20                                     # the log keeps this many lines


def _year(state: dict) -> int:
    try:
        from sim import season
        return season.season_year(state)
    except Exception:
        return int(state.get("season_year") or 0)


def _clamp(v: float) -> float:
    return max(0.0, min(100.0, v))


def _seen(state: dict) -> dict:
    """The book without creating it (reads never write into the save)."""
    return (state.get("career") or {}).get("word") or {}


def book(state: dict) -> dict:
    """The coach's word, created on first use."""
    return state.setdefault("career", {}).setdefault("word", {"overall": WORD_START, "by_group": {}, "log": []})


def apply(state: dict, kind: str, group: str, name: str, star: bool = False, personality: str = "") -> float:
    """One kept or broken promise: the overall takes the delta (clamped 0-100), the player's position takes it again on
    top. Returns the delta."""
    if kind in GAIN:
        delta = float(GAIN[kind])
    elif kind in COST:
        delta = -float(COST[kind]) * (STAR_COST if star else 1.0) * (GUARDED_COST if personality == "guarded" else 1.0)
    else:
        raise ValueError(f"unknown word event {kind!r}")
    b = book(state)
    b["overall"] = _clamp(b.get("overall", WORD_START) + delta)
    if group:
        g = b.setdefault("by_group", {})
        g[group] = max(-100.0, min(100.0, g.get(group, 0.0) + delta * GROUP_EXTRA))
    log = b.setdefault("log", [])
    log.append({"year": _year(state), "kind": kind, "group": group, "name": name, "delta": round(delta, 2)})
    del log[:-LOG_KEEP]
    return delta


def reading(state: dict, group: Optional[str] = None) -> float:
    """The word, 0-100: the overall plus the position's extra when given."""
    b = _seen(state)
    v = b.get("overall", WORD_START)
    if group:
        v += (b.get("by_group") or {}).get(group, 0.0)
    return _clamp(v)


def recover(state: dict, year: Optional[int] = None) -> None:
    """An offseason passes: the overall moves RECOVER of the way back to WORD_START; each position's extra fades. Given
    the offseason's year, once per year."""
    b = _seen(state)
    if not b or (year is not None and str(year) in (b.get("recovered") or ())):
        return
    if year is not None:
        b.setdefault("recovered", []).append(str(year))
    b["overall"] = _clamp(b.get("overall", WORD_START) + (WORD_START - b.get("overall", WORD_START)) * RECOVER)
    b["by_group"] = {g: v * GROUP_DECAY for g, v in (b.get("by_group") or {}).items() if abs(v * GROUP_DECAY) >= 0.5}


def word_text(value: float) -> str:
    from coach_career import programs
    return next(w for w, f in programs.WORD_FLOORS if value >= f)


def last_broken(state: dict, group: str) -> Optional[str]:
    """The most recent broken promise's player at this position."""
    for e in reversed(_seen(state).get("log") or ()):
        if e.get("group") == group and e.get("kind") in COST and e.get("kind") != "bent":
            return e.get("name")
    return None


# ----- what feeds it -----------------------------------------------------------------------------------------------------

BAND_KIND = {"kept": "kept", "bent": "bent", "broken": "broken"}   # a judged season's band -> the word's event ("none": nothing)


def apply_bands(state: dict, year: int, bands: Optional[dict] = None) -> None:
    """Your promised players' season, judged (promises.bands), moves the word once per year. Name, position, overall
    and stars come from your roster row; a player no longer on it is skipped."""
    if bands is None:
        from coach_career import promises
        bands = promises.bands(state, year)
    b = _seen(state)
    if str(year) in (b.get("applied") or ()):
        return
    from coach_career import offseason
    me = state.get("team")
    rows = {c["id"]: c for c in (((state.get("league") or {}).get("teams") or {}).get(me) or {}).get("roster") or ()}
    for slug, info in bands.items():
        kind, c = BAND_KIND.get(info.get("band")), rows.get(slug)
        if kind is None or c is None:
            continue
        star = offseason.house(c["pos"], c["o"]) >= STAR_OVR or (c.get("s") or 0) >= 4
        apply(state, kind, offseason.GROUP.get(c["pos"], c["pos"]), c.get("n") or "", star=star, personality=info.get("personality") or "")
    book(state).setdefault("applied", []).append(str(year))


def recruit_event(state: dict, slug: str, pid: str, kind: str) -> None:
    """A recruiting promise kept or broken (money, package, roster): your school's only; his position from his EA
    position, a star at four stars or better."""
    if slug != state.get("team"):
        return
    from coach_career import persona, recruiting
    p = state["recruiting"]["prospects"].get(pid)
    if p is None:
        return
    apply(state, kind, recruiting._group_of(p), p.get("name") or "", star=(p.get("stars") or 0) >= 4,
          personality=persona.of(state, pid)["personality"])


# ----- what recruits read --------------------------------------------------------------------------------------------------

def promise_mult(state: dict, pid: Optional[str], group: Optional[str], personality: Optional[str] = None,
                 decider: Optional[str] = None) -> float:
    """What a believed promise is worth, times its base: PROMISE_MULT by the reading at his position (1.0 at 50); a
    Guarded player, or one whose decider is playing time, reads the distance from 1.0 CARES_MORE times as hard. A
    recruit's personality and decider come from his persona; a roster player's are passed in."""
    lo, hi = PROMISE_MULT
    m = lo + (hi - lo) * reading(state, group) / 100.0
    if pid is not None and personality is None:
        rc = state.get("recruiting") or {}
        if pid in (rc.get("prospects") or {}):
            from coach_career import persona
            per = persona.of(state, pid)
            personality, decider = per.get("personality"), per.get("decider_topic")
    if personality == "guarded" or decider == "playing_time":
        m = 1.0 + (m - 1.0) * CARES_MORE
    return m


def believes(state: dict, group: Optional[str]) -> bool:
    """Whether a promise is believed at all: the reading at his position at FLOOR or above."""
    return reading(state, group) >= FLOOR


# ----- what you see (the Office's Keeps His Word card) -------------------------------------------------------------------

GROUP_NAMES = {"QB": "Quarterbacks", "RB": "Running Backs", "WR": "Receivers", "TE": "Tight Ends", "OL": "Offensive Linemen",
               "DL": "Defensive Linemen", "LB": "Linebackers", "CB": "Cornerbacks", "S": "Safeties", "K": "Kickers", "P": "Punters"}
RECENT = 3                                        # the card shows this many of the latest lines


def _line(e: dict) -> str:
    verb = "Kept" if e.get("kind") in GAIN else "Bent" if e.get("kind") == "bent" else "Broke"
    who = e.get("name") or "a player"
    return f"{verb} your word to {who} ({e['group']})." if e.get("group") else f"{verb} your word to {who}."


def view(state: dict) -> dict:
    """The word in a word; the position with the lowest reading when its word is below the overall's; the latest lines."""
    overall = reading(state)
    text = word_text(overall)
    weakest = None
    groups = (_seen(state).get("by_group") or {})
    if groups:
        g = min(groups, key=lambda k: (reading(state, k), k))
        low = reading(state, g)
        if low < overall and word_text(low) != text:
            weakest = {"group": g, "name": GROUP_NAMES.get(g, g), "text": word_text(low)}
    recent = [_line(e) for e in reversed((_seen(state).get("log") or [])[-RECENT:])]
    return {"text": text, "weakest": weakest, "recent": recent}
