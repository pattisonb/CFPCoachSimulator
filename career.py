"""Coach Career (docs/superpowers/specs/2026-10-22-coach-career-design.md): a season played as
the head coach. A career is a season state with a `career` block: the year, your coach, your
settings and when it was last saved. Seasons without one (older saves, "remaining" mode, Real
2026) are plain seasons and nothing here touches them."""
from __future__ import annotations

import gzip
import json
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
    import recruiting
    recruiting.start(state)
    return state["career"]


def is_career(state: dict) -> bool:
    return bool(state.get("career"))


# ----- saves: the browser keeps a copy and restores it when the server has forgotten the season -----

def export_save(state: dict) -> bytes:
    """The whole career as one gzip file: the season state and every saved box score."""
    import season
    boxes = {p.name: p.read_text(encoding="utf-8") for p in sorted(season.box_dir(state).glob("*.json"))} \
        if season.box_dir(state).exists() else {}
    return gzip.compress(json.dumps({"state": state, "boxes": boxes}, separators=(",", ":")).encode("utf-8"))


def read_save(blob: bytes) -> tuple[dict, dict]:
    """A downloaded career's (state, box scores), without writing anything. Raises ValueError
    for anything that is not a career save."""
    try:
        data = json.loads(gzip.decompress(blob).decode("utf-8"))
        state = data["state"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ValueError("not a Coach Career save") from exc
    if not isinstance(state, dict) or not is_career(state) or not str(state.get("id", "")).isalnum():
        raise ValueError("not a Coach Career save")
    boxes = {n: t for n, t in (data.get("boxes") or {}).items()
             if isinstance(t, str) and n.endswith(".json") and "/" not in n and "\\" not in n and ".." not in n}
    return state, boxes


def write_save(state: dict, boxes: dict) -> None:
    """Put a career on the server's disk as it was saved (its stamp unchanged)."""
    import season
    d = season.box_dir(state)
    d.mkdir(parents=True, exist_ok=True)
    for name, text in boxes.items():
        (d / name).write_text(text, encoding="utf-8")
    (season.SEASONS_DIR / f"{state['id']}.json").write_text(json.dumps(state), encoding="utf-8")


def import_save(blob: bytes) -> dict:
    """Write a downloaded career back to the server's disk and return its state."""
    state, boxes = read_save(blob)
    write_save(state, boxes)
    return state


def restore(blob: bytes, current: Optional[dict]) -> dict:
    """An uploaded career against the server's copy of it (`current`, None when the server has
    forgotten it): the newer one is kept and returned; the upload is written only if it wins."""
    state, boxes = read_save(blob)
    if current is not None and current.get("id") == state["id"] and newer(current, state) is current:
        return current
    write_save(state, boxes)
    return state


def newer(a: dict, b: dict) -> dict:
    """The later of two copies of the same career: more weeks played, then saved later."""
    key = lambda s: (s["career"].get("saved_week", 0), s["career"].get("saved_at", ""))
    return b if key(b) > key(a) else a
