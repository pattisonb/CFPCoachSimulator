"""Program ratings (docs/superpowers/specs/2026-10-26-program-ratings-design.md). This first
piece is the market: how many people watch a program, from real home crowds (CFBD, 2023-2025)
and TV audiences (Nielsen's published per-team averages, estimated from the crowd where none is
published), built by tools/build_program_market.py into data/program_market.json."""
from __future__ import annotations

import json
from pathlib import Path

MARKET = Path(__file__).resolve().parents[1] / "data" / "program_market.json"
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
