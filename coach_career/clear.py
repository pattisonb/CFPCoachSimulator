"""Clear Mode (the player's experiment, on the clear-mode branch): the game says what it knows in numbers, not words.

- A prospect's scouting shows up to eight of his position's key ratings, each a range that narrows with every look,
  with the staff's confidence in a word (High, Medium, Low), instead of grade words over bars. Potential reads as a
  range at his position. The report's verdict, strengths and the uncertainty card stay.
- Conversations are transactional: each topic you pitch gets a plain Yes (one of his priorities) or No.
- Once his report is complete you know his priorities, who decides and his personality: no guesswork.
- Chances, interest, your program's case and the like read as numbers.

CLEAR is the switch: on for this branch. Nothing here changes how a game or a recruit plays; it changes what the
player is shown and when he learns it.
"""
from __future__ import annotations

from typing import Optional

CLEAR = True                     # *tune* the branch's switch: Clear Mode on

CONFIDENCE = {"Low": "High", "Medium": "Medium", "High": "Low"}   # a read's uncertainty word -> the confidence word shown

# each position group's key player-card ratings, most important first (up to eight); the card's own labels name them
KEYS = {
    "QB": ("arm_strength", "short_accuracy", "mid_accuracy", "deep_accuracy", "decision_making", "pocket_poise", "throw_on_move", "football_iq"),
    "RB": ("run_vision", "burst", "agility", "elusiveness", "ball_security", "power_running", "top_speed", "tackle_breaking"),
    "FB": ("lead_block", "drive_block", "power_running", "strength", "run_vision", "hands", "ball_security", "football_iq"),
    "WR": ("hands", "top_speed", "release", "short_routes", "mid_routes", "deep_routes", "contested_catch", "agility"),
    "TE": ("hands", "drive_block", "reach_block", "contested_catch", "short_routes", "mid_routes", "release", "strength"),
    "OL": ("pass_anchor", "pass_footwork", "drive_block", "reach_block", "strength", "finish_block", "agility", "football_iq"),
    "DL": ("power_rush", "speed_rush", "block_shedding", "strength", "burst", "tackling", "pursuit", "diagnosis"),
    "LB": ("tackling", "diagnosis", "pursuit", "block_shedding", "zone_coverage", "man_coverage", "hit_power", "top_speed"),
    "CB": ("man_coverage", "zone_coverage", "press", "top_speed", "agility", "ball_skills", "diagnosis", "burst"),
    "S": ("zone_coverage", "man_coverage", "diagnosis", "tackling", "pursuit", "ball_skills", "top_speed", "hit_power"),
    "K": ("kick_power", "kick_accuracy", "football_iq", "stamina"),
    "P": ("punt_power", "punt_accuracy", "football_iq", "stamina"),
}


def on() -> bool:
    return CLEAR


def confidence(state: dict, pid: str, group: str) -> str:
    """How sure the staff is of a read, in a word: High, Medium or Low (the report's uncertainty, turned around)."""
    from coach_career import prospects as pr
    return CONFIDENCE.get(pr.uncertainty(state, pid, group) or "High", "Low")


def _raw_half(state: dict, pid: str, group: str) -> Optional[tuple[float, float]]:
    """(mean, half) of a group read without the word slack (the read itself)."""
    from coach_career import recruiting
    spread = recruiting.read_spread(state, pid, group)
    if spread is None:
        return None
    mean, half = spread
    return mean, half + recruiting.WORD_SLACK


def _group_of_key(p: dict, key: str) -> str:
    """The scouting group a card rating reads through: athleticism, size and strength, football IQ, else technique."""
    from coach_career import prospects as pr
    for g in ("athleticism", "size_strength", "football_iq"):
        if key in pr.GAME_GROUPS.get(g, ()):
            return g
    return "technique"


def ratings(state: dict, pid: str) -> Optional[dict]:
    """His key ratings as the staff reads them, or None before any look: {"complete", "rows": [{key, label, est, lo, hi,
    confidence}], "overall": {...}, "potential": {...}}. A rating's estimate is his true card rating moved by the staff's
    error on its group (the same error the grade words carried), so it is no more exact than the old words were, only
    said plainly. Always a range: it narrows with every look (a complete report's is a few points wide)."""
    from coach_career import prospects as pr, recruiting
    from sim import season
    from teamdata import ratings as rv2
    rc = state["recruiting"]
    p = rc["prospects"].get(pid)
    read = rc["reads"].get(pid)
    if not p or not read:
        return None
    complete = recruiting.report_complete(read)
    attrs = rc.get("attrs")
    cards = pr.card_attributes(dict(zip(attrs, p["ratings"])), p)
    pos = pr.engine_position(p)
    grp = season.SCALE_GROUP.get(pos, pos)
    keys = [k for k in KEYS.get(grp, ()) if k in cards][:8]

    def row(key: str, label: str, truth: float, group: str) -> dict:
        mh = _raw_half(state, pid, group)
        if mh is None:
            return {"key": key, "label": label, "est": None, "lo": None, "hi": None, "confidence": None}
        mean, half = mh
        err = mean - p["truth"][group]
        est = max(1, min(99, int(round(truth + err))))
        half = max(2.0, half)                        # never a single number: the read's own width, at least a couple of points
        lo, hi = max(1, int(round(est - half))), min(99, int(round(est + half)))
        return {"key": key, "label": label, "est": est, "lo": lo, "hi": hi, "confidence": confidence(state, pid, group)}

    rows = [row(k, rv2.ATTRIBUTES[k][0], cards[k], _group_of_key(p, k)) for k in keys]
    pos_label = pr.display_pos(p["ea_position"])
    pot = row("potential", f"Potential at {pos_label}", float(p["pot_ovr"]), "potential")   # his projected overall at his position
    pot["position"] = pos_label
    return {"complete": complete, "looks": recruiting.report_looks(read), "rows": rows, "potential": pot}
