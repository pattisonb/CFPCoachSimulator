"""Coach Career (docs/superpowers/specs/2026-10-22-coach-career-design.md): a season played as
the head coach. A career is a season state with a `career` block: the year, your coach, your
settings and when it was last saved. Seasons without one (older saves, "remaining" mode, Real
2026) are plain seasons and nothing here touches them."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

FIRST_YEAR = 2026


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_career(state: dict, coach: Optional[dict]) -> dict:
    """Make `state` a career and return its career block. `coach` is a created coach (the Your
    coach page) or None for the team's own head coach."""
    state["career"] = {
        "year": FIRST_YEAR,
        "coach": {"id": coach.get("id"), "name": f"{coach.get('first_name', '')} {coach.get('last_name', '')}".strip()} if coach else None,
        "settings": {"auto_recruit": False},
        "saved_week": 0,
        "saved_at": _now(),
    }
    return state["career"]


def is_career(state: dict) -> bool:
    return bool(state.get("career"))
