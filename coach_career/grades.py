"""Letter grades for a player's overall potential (the player's ask): A through F in place of the number, on the page
only. Nothing here is read by the sim or by any recruiting decision: a view turns a potential (or a read's two ends)
into letters as it is sent.

A letter is a 20-point band of the 1-99 scale. A plus or a minus is a finer read, a third of a band, and it takes a
sharp eye: your staff's and your own evaluating ability (`eye`) at PLUS_MINUS_EYE or better. Your own players always
show it: you coach them every day."""
from __future__ import annotations

BANDS = (("A", 80), ("B", 60), ("C", 40), ("D", 20), ("F", 0))   # *tune* a letter and the lowest potential that earns it
PLUS_FROM, MINUS_UNDER = 13, 7     # *tune* inside a band's 20 points: this far up is a plus, under this a minus
NO_FINE = ("F",)                   # *tune* letters that take no plus or minus
PLUS_MINUS_EYE = 70                # *tune* your best evaluator (staff or you) at this or better reads plus and minus

# every grade, worst first: its place is how it sorts
ORDER = tuple(g for letter, _ in reversed(BANDS) for g in ((letter,) if letter in NO_FINE else (letter + "-", letter, letter + "+")))


def letter(value: float, fine: bool = False) -> str:
    """The letter for a potential on the 1-99 scale; with `fine`, its plus or minus."""
    v = max(0.0, min(99.0, float(value)))
    name, floor = next((n, f) for n, f in BANDS if v >= f)
    if not fine or name in NO_FINE:
        return name
    into = v - floor
    return name + ("+" if into >= PLUS_FROM else "-" if into < MINUS_UNDER else "")


def place(grade: str) -> int:
    """Where a grade sorts, worst (0) to best: a bare letter sits between its minus and its plus."""
    return ORDER.index(grade) if grade in ORDER else -1


def eye(state: dict) -> int:
    """Your side's best evaluating ability: your staff's evaluation ratings (your coordinators' is their player
    development; your recruiters have their own) and your own player development as head coach."""
    staff = (state.get("career") or {}).get("staff") or []
    mine = 0
    try:
        from sim import season
        hc = ((season.team_data(state, state["team"]).get("coaches") or {}).get("head_coach")) or {}
        mine = int((hc.get("ratings") or {}).get("player_development") or 0)
    except Exception:
        mine = 0
    return max([int(m.get("evaluation") or 0) for m in staff] + [mine])


def fine(state: dict) -> bool:
    """Whether your reads of a recruit carry a plus or a minus."""
    return eye(state) >= PLUS_MINUS_EYE


def span(lo: float, hi: float, fine_read: bool) -> list[str]:
    """A read's two ends as letters, low then high (the same letter twice once it sits in one grade)."""
    a, b = letter(min(lo, hi), fine_read), letter(max(lo, hi), fine_read)
    return [a, b]


def sort_key(grades: list[str]) -> int:
    """A shown read as one number to sort by, best first: its high grade, then its low one. Two reads that show the
    same letters tie (the caller breaks it by national rank): the number behind them never orders them."""
    return -(place(grades[-1]) * 100 + place(grades[0]))
