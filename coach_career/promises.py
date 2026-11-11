"""Promises judged all season (docs/superpowers/specs/2026-11-10-promises-expansion-design.md, sections 2-4).

A starting role you promised a player (at Keep Them Home, to a recruit or to a portal signee: his league roster row's
`promised` is the season it is for) is judged week by week. Before each week's games the career records whether he
starts (`snapshot_week`, sim/season.advance); his `score` weighs late weeks and big games more, a benching in a big game
(more for a quarterback) costs extra, and a week he is injured does not count. His personality sets the bar (`BANDS`):
the score lands Kept, Bent or Broken, read by the offseason (offseason.portal_odds, Keep Them Home) and shown during the
season as a chip (`chip`: On Track, Slipping, Broken)."""
from __future__ import annotations

from typing import Optional

LATE_WEIGHT = 2.0          # *tune* week i of n weighs 1 + LATE_WEIGHT * i / (n - 1): how it ends counts most
BIG_WEIGHT = 2.0           # *tune* a big game (rivalry, ranked opponent, title game, bowl, playoff) weighs this much more
BENCH_HIT = 0.15           # *tune* score lost when he started earlier and sat a later big game while healthy
POSITION_HIT = {"QB": 1.5, "OL": 0.6, "K": 0.5, "P": 0.5}    # *tune* scales BENCH_HIT by his position group (others 1.0)
BANDS = {"default": (0.60, 0.35), "cocky": (0.75, 0.50), "shy": (0.50, 0.25)}   # *tune* (kept at, broken under) by personality
ATTENTION_BIG = 2.0        # *tune* a Loves the Attention player's big games weigh this much more again
COCKY_HIT = 1.5            # *tune* a Cocky player's big-game benching costs this much more
CHIPS = {"kept": "On Track", "bent": "Slipping", "broken": "Broken"}


def record(state: dict) -> dict:
    """The season-by-season record: str(year) -> slug -> [{"week", "started", "injured", "big"}]."""
    return state.setdefault("promises", {})


def _group(position: str) -> str:
    from coach_career import offseason
    return offseason.GROUP.get(position, position)


def benched_big(weeks: list[dict]) -> bool:
    """He started some week and then sat a later big game while healthy."""
    started = False
    for w in weeks:
        if w["injured"]:
            continue
        if w["started"]:
            started = True
        elif w["big"] and started:
            return True
    return False


def score(weeks: list[dict], position: str, personality: str) -> Optional[float]:
    """0-1: the weighted share of the weeks that count (not injured) in which he started, less the big-game benching
    hit; None when no week counts."""
    counted = [w for w in weeks if not w["injured"]]
    n = len(counted)
    if not n:
        return None
    big = BIG_WEIGHT * (ATTENTION_BIG if personality == "attention" else 1.0)
    weights = [(1 + LATE_WEIGHT * i / (n - 1) if n > 1 else 1.0) * (big if w["big"] else 1.0) for i, w in enumerate(counted)]
    s = sum(x for x, w in zip(weights, counted) if w["started"]) / sum(weights)
    if benched_big(weeks):
        s -= BENCH_HIT * POSITION_HIT.get(_group(position), 1.0) * (COCKY_HIT if personality == "cocky" else 1.0)
    return round(max(0.0, s), 3)


def band(s: Optional[float], personality: str) -> str:
    """"kept", "bent" or "broken" by his personality's bar; "none" when no week counted."""
    if s is None:
        return "none"
    kept_at, broken_under = BANDS.get(personality, BANDS["default"])
    return "kept" if s >= kept_at else "broken" if s < broken_under else "bent"


def chip(b: str) -> Optional[str]:
    """The chip's word for a band: On Track, Slipping, Broken; None for "none"."""
    return CHIPS.get(b)


def personality_of(state: dict, slug: str) -> str:
    """His personality: the persona his league roster row carries, else a stable draw for him."""
    from coach_career import persona
    for t in ((state.get("league") or {}).get("teams") or {}).values():
        for c in t.get("roster") or ():
            if c["id"] == slug and (c.get("persona") or {}).get("personality"):
                return c["persona"]["personality"]
    return persona.draw(slug, "roster")["personality"]


# ----- the weekly snapshot (sim/season.advance, before the week's games) -----------------------------------------------

def promised_now(state: dict) -> dict[str, dict]:
    """Your league roster rows promised a starting role for this season, by slug ({} in a first season: no league)."""
    from sim import season
    lgd = state.get("league")
    if not lgd or not state.get("team"):
        return {}
    year = season.season_year(state)
    return {c["id"]: c for c in (lgd["teams"].get(state["team"]) or {}).get("roster") or () if c.get("promised") == year}


def _game(state: dict, slug: str, week: int) -> Optional[dict]:
    return next((g for g in state["games"].values() if g["week"] == week and slug in (g["home"], g["away"])), None)


def is_big(state: dict, slug: str, week: int) -> bool:
    """Your game that week is a title game, a bowl or the playoff, a rivalry, or against a ranked opponent."""
    from sim import season
    g = _game(state, slug, week)
    if g is None:
        return False
    if g.get("kind") in ("ccg", "bowl", "playoff"):
        return True
    other = g["away"] if g["home"] == slug else g["home"]
    return season.rivalry_for(g["home"], g["away"]) is not None or other in season.rank_map(state, week - 1)


def snapshot_week(state: dict, week: int) -> None:
    """Record each promised player's week: started (in the lineup the week's games will use), injured (on the injury
    list, not redshirting), big. A bye records nothing; a week already recorded is not recorded twice."""
    from sim import season
    promised = promised_now(state)
    me = state.get("team")
    if not promised or _game(state, me, week) is None:
        return
    team = season._preview_team(state, me)
    rows = {p.get("slug"): p for p in team["offense"] + team["defense"]}
    hurt = {i.get("name") for i in ((state.get("injuries") or {}).get(me) or {}).values()}
    big = is_big(state, me, week)
    year = record(state).setdefault(str(season.season_year(state)), {})
    for slug in promised:
        weeks = year.setdefault(slug, [])
        if any(w["week"] == week for w in weeks):
            continue
        p = rows.get(slug) or {}
        injured = p.get("name") in hurt
        weeks.append({"week": week, "started": bool(p.get("in_game")) and not injured, "injured": injured, "big": big})
