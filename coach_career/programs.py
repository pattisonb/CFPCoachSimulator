"""Program ratings (docs/superpowers/specs/2026-10-26-program-ratings-design.md). This first
piece is the market: how many people watch a program, from real home crowds (CFBD, 2023-2025)
and TV audiences (Nielsen's published per-team averages, estimated from the crowd where none is
published), built by tools/build_program_market.py into data/program_market.json."""
from __future__ import annotations

import json
from pathlib import Path

MARKET = Path(__file__).resolve().parents[1] / "data" / "program_market.json"
HISTORY = Path(__file__).resolve().parents[1] / "data" / "program_history.json"
WEIGHTS = {"prestige": 0.35, "winning": 0.20, "nil": 0.15, "market": 0.10, "conference": 0.10, "coach": 0.10}
TIERS = ((80, 1), (65, 2), (50, 3), (35, 4))         # rating floors; below the last is tier 5
TIER_NAMES = {1: "Blue blood", 2: "Power", 3: "Solid", 4: "Group of 5", 5: "Bottom"}
BASE_DEFAULT = {"history": 15.0, "prestige": 15.0, "winning": 20.0, "market": 25, "nil": 15.0, "conference": 10.0, "coach": 55.0}
MARKET_DEFAULT = 25              # a program without three seasons of FBS crowds (new to FBS)
P4 = {"SEC", "Big Ten", "Big 12", "ACC"}
_cache: dict = {}


def _market() -> dict:
    if "teams" not in _cache:
        _cache["teams"] = json.loads(MARKET.read_text(encoding="utf-8"))["teams"] if MARKET.exists() else {}
    return _cache["teams"]


def market(slug: str) -> int:
    """The program's market, 0-100 (60% crowd, 40% TV)."""
    return int(_market().get(slug, {}).get("market", MARKET_DEFAULT))


def market_row(slug: str) -> dict:
    """The market with its parts: attendance, games counted, TV millions and whether published."""
    row = _market().get(slug)
    if not row:
        return {"attendance": None, "attendance_games": 0, "tv_millions": None, "tv_known": False, "market": MARKET_DEFAULT}
    return dict(row)


def mix(p: dict) -> float:
    """The rating: the weighted mix of the six metrics."""
    return sum(w * float(p.get(k, 0)) for k, w in WEIGHTS.items())


def tier_of(rating: float) -> int:
    for floor, t in TIERS:
        if rating >= floor:
            return t
    return 5


def _history() -> dict:
    if "history" not in _cache:
        _cache["history"] = json.loads(HISTORY.read_text(encoding="utf-8")) if HISTORY.exists() else {"teams": {}, "z_fit": {"a": -3.0, "b": 0.05}}
    return _cache["history"]


def base(slug: str) -> dict:
    """A program's starting values (data/program_history.json), a new FBS program's floor when unknown."""
    p = _history()["teams"].get(slug)
    if p:
        return dict(p)
    p = dict(BASE_DEFAULT, market=market(slug))
    p["rating"] = round(mix(p), 1)
    p["tier"] = tier_of(p["rating"])
    return p


def z_of(rating: float) -> float:
    """The rating on the recruiting baseline's scale (about -2 to +2), for the readers that grew up on it."""
    f = _history()["z_fit"]
    return f["a"] + f["b"] * float(rating)
