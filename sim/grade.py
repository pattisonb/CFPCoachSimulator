"""The Season Grade on the Season Recap: a letter (A+ to F) and a one-sentence verdict, read off
what the season already knows. Nothing here is random and nothing is written to the state: the
grade is a pure function of the record against the AD's goal (coach_career/programs.GOALS), the
conference title, how far the playoff run went, the bowl, and the final AP rank.

    season_grade(state) -> {"grade": "B-", "score": 81, "band": "met", "line": "..."}

A score starts at GRADE_BASE (a season exactly at the goal's win count) and moves by the table
below; the letter is read off GRADE_LETTERS. A national champion is always an A+, and only a
champion is. The verdict is one sentence per band (GRADE_LINES), keyed by what the season was:
champion, a playoff run, the goal met, a bowl trip short of the goal, the goal missed, a losing
season, or a fired-level season (an F)."""
from __future__ import annotations

from typing import Optional

GRADE_BASE = 80              # a season right at the AD's goal: a B- *tune*
GRADE_PER_WIN = 3            # each win over (under) the goal's win count *tune*
GRADE_CONFERENCE = 4         # a conference title *tune*
GRADE_PLAYOFF = {17: 3, 18: 5, 19: 8, 20: 11}   # the furthest playoff week played: first round, quarterfinals, semifinals, the title game *tune*
GRADE_BOWL_WIN = 3           # a bowl won (a bowl lost moves nothing) *tune*
GRADE_RANK = ((10, 3), (25, 1))                 # a final AP rank inside the top 10, the top 25 *tune*
GRADE_MISSED_KIND = -6       # the goal asked for the playoff or the conference title and the wins came without it *tune*
GRADE_LOSING = -4            # a losing season, on top of the wins under the goal *tune*
GRADE_CAP = 96               # the best a season without the title can score: an A, never the A+ *tune*
GRADE_LETTERS = (("A+", 97), ("A", 93), ("A-", 90), ("B+", 87), ("B", 83), ("B-", 80), ("C+", 77), ("C", 73), ("C-", 70),
                 ("D+", 67), ("D", 63), ("D-", 60), ("F", 0))

ROUND_WORDS = {17: "the first round", 18: "the quarterfinals", 19: "the semifinals", 20: "the national championship game"}
# one sentence per band; {record} is the final record, {goal} the AD's goal in lowercase, {round} the playoff exit
GRADE_LINES = {
    "champion": "National champions at {record}: the season every program dreams of.",
    "playoff": "A playoff season at {record}; the run ended in {round}.",
    "met": "The AD asked you to {goal}, and {record} did it: a season to build on.",
    "bowl": "A {record} season that reached a bowl but fell short of the AD's goal to {goal}.",
    "missed": "A competitive {record} season, but it fell short of the postseason and the AD's goal to {goal}.",
    "losing": "A losing season at {record}; the program needs a better year.",
    "fired": "A {record} season that puts the job in question.",
}


def _letter(score: float) -> str:
    for letter, floor in GRADE_LETTERS:
        if score >= floor:
            return letter
    return "F"


def _my_games(state: dict) -> list[dict]:
    me = state["team"]
    return sorted((g for g in state["games"].values() if g["played"] and me in (g["home"], g["away"])), key=lambda g: g["week"])


def _won(g: dict, me: str) -> bool:
    mine = g["home_score"] if g["home"] == me else g["away_score"]
    theirs = g["away_score"] if g["home"] == me else g["home_score"]
    return mine > theirs


def season_grade(state: dict) -> dict:
    """The letter, its score, the band and the verdict for the season as it stands."""
    from coach_career import carousel
    from sim import season

    me = state["team"]
    rec = season._records(state, include_playoff=True)[me]
    wins, losses = rec["wins"], rec["losses"]
    goal = carousel.goal(me, state)
    games = _my_games(state)
    playoff = [g for g in games if g["kind"] == "playoff"]
    bowls = [g for g in games if g["kind"] == "bowl"]
    champion = state.get("champion") == me
    conf_title = (state.get("champions") or {}).get(state["conference"]) == me
    last_poll = (state.get("polls") or {}).get(str(max((int(k) for k in state.get("polls") or {}), default=0)), {})
    rank: Optional[int] = next((e["rank"] for e in last_poll.get("ap", []) if e["team"] == me), None)
    met = wins >= goal["wins"] and (goal["kind"] != "playoff" or bool(playoff)) and (goal["kind"] != "conference" or conf_title)

    score = GRADE_BASE + GRADE_PER_WIN * (wins - goal["wins"])
    if conf_title:
        score += GRADE_CONFERENCE
    if playoff:
        score += GRADE_PLAYOFF.get(max(g["week"] for g in playoff), 0)
    if bowls and _won(bowls[-1], me):
        score += GRADE_BOWL_WIN
    if rank:
        score += next((pts for top, pts in GRADE_RANK if rank <= top), 0)
    if wins >= goal["wins"] and not met:
        score += GRADE_MISSED_KIND
    if wins < losses:
        score += GRADE_LOSING
    score = int(round(score))
    grade = "A+" if champion else _letter(min(score, GRADE_CAP))

    if champion:
        band = "champion"
    elif playoff:
        band = "playoff"
    elif grade == "F":
        band = "fired"
    elif wins < losses:
        band = "losing"
    elif met:
        band = "met"
    elif bowls:
        band = "bowl"
    else:
        band = "missed"
    text = goal["text"]
    line = GRADE_LINES[band].format(record=f"{wins}-{losses}", goal=text[:1].lower() + text[1:],
                                    round=ROUND_WORDS.get(max((g["week"] for g in playoff), default=0), "the playoff"))
    return {"grade": grade, "score": score, "band": band, "line": line, "goal": text, "met": met}
