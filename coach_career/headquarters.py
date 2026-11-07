"""Headquarters: the player's own dashboard of recruiting and scouting widgets (spec
docs/superpowers/specs/2026-11-07-headquarters-design.md). The page owns the widgets; this module keeps
the layout in the career save and computes the two reads no other view has: your commits by week and this
week's movers on your board. Nothing here touches the season sim (the layout is outside the golden digest)."""
import re
from typing import Optional

from coach_career import recruiting

HQ_MAX_CARDS = 40        # *tune* the most cards a Headquarters holds
MOVERS_SHOWN = 5         # *tune* risers and fallers each the Hot and Cold Movers widget gets
SIZES = ("S", "M", "L")
_ID = re.compile(r"^[a-z0-9-]{1,40}$")


class LayoutError(Exception):
    """A layout of the wrong shape; nothing was stored."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def layout(state: dict) -> dict:
    """The saved layout: {"cards": [{"id", "widget", "size"}, ...]}; an old save without one reads empty."""
    hq = (state.get("career") or {}).get("headquarters") or {}
    return {"cards": [dict(c) for c in hq.get("cards") or []]}


def set_layout(state: dict, cards) -> dict:
    """Check the shape and store the layout. The widget ids are not checked against a list: the page owns the
    widgets, and a newer page's widget in an older save is kept."""
    if not isinstance(cards, list):
        raise LayoutError("The layout must be a list of cards.")
    if len(cards) > HQ_MAX_CARDS:
        raise LayoutError(f"A Headquarters holds at most {HQ_MAX_CARDS} widgets.")
    seen, out = set(), []
    for c in cards:
        if not isinstance(c, dict):
            raise LayoutError("Each card must have an id, a widget and a size.")
        cid, widget, size = c.get("id"), c.get("widget"), c.get("size")
        if not (isinstance(cid, str) and _ID.match(cid)) or not (isinstance(widget, str) and _ID.match(widget)):
            raise LayoutError("Card and widget ids are short lowercase words with dashes.")
        if size not in SIZES:
            raise LayoutError("A widget's size is S, M or L.")
        if cid in seen:
            raise LayoutError("Each card id appears once.")
        seen.add(cid)
        out.append({"id": cid, "widget": widget, "size": size})
    state["career"]["headquarters"] = {"cards": out}
    return layout(state)


def _committed_now(state: dict, me: str) -> int:
    """Your commits in the live recruiting block (the class, or the portal in its weeks), as the board counts them."""
    rc = state["recruiting"]
    return sum(1 for s in rc["status"].values() if s.get("committed") == me)


def commits_by_week(state: dict) -> list:
    """Your commits week by week from the recruiting log: [{"week", "gained", "lost", "total"}], a row for
    every week from the first to now (the portal's weeks in the portal). A commit or a flip to you is gained,
    a decommit from you lost; what you held before the log began counts in the first week's total, so the
    last total is exactly your commits now."""
    rc, me = state["recruiting"], state["team"]
    portal = bool(rc.get("portal"))
    now = int((rc.get("week") if portal else state.get("current_week")) or 0)
    gained: dict[int, int] = {}
    lost: dict[int, int] = {}
    for e in rc.get("log") or []:
        if e.get("school") != me:
            continue
        w = e.get("portal_week") if portal else e.get("week")
        if w is None:
            continue
        w = int(w)
        if e.get("kind") in ("commit", "flip"):
            gained[w] = gained.get(w, 0) + 1
        elif e.get("kind") == "decommit":
            lost[w] = lost.get(w, 0) + 1
    first = min([1 if now >= 1 else 0, *gained, *lost])
    last = max([now, *gained, *lost])
    start = max(0, _committed_now(state, me) - (sum(gained.values()) - sum(lost.values())))
    rows, total = [], start
    for w in range(first, last + 1):
        g, l = gained.get(w, 0), lost.get(w, 0)
        total += g - l
        rows.append({"week": w, "gained": g, "lost": l, "total": max(0, total)})
    return rows


def movers(state: dict) -> dict:
    """This week's risers and fallers on your board, from the latest weekly report: your place on his list
    now against a week ago. {"up": [...], "down": [...]}, MOVERS_SHOWN each, most places moved first. The
    page shows them with your standing in words, never the place itself."""
    report: Optional[dict] = recruiting.latest_report(state)
    up, down = [], []
    for r in (report or {}).get("rows") or []:
        rank, prev = r.get("rank"), r.get("prev_rank")
        if rank is None or prev is None or rank == prev:
            continue
        row = {"pid": r["pid"], "name": r["name"], "position": r["position"], "stars": r["stars"], "places": abs(prev - rank)}
        (up if rank < prev else down).append(row)
    key = lambda x: (-x["places"], x["name"])
    return {"up": sorted(up, key=key)[:MOVERS_SHOWN], "down": sorted(down, key=key)[:MOVERS_SHOWN]}
