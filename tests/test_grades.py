"""Letter grades for overall potential (coach_career/grades.py): the bands, the plus and minus, how reads sort."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import grades


def shown_at(v):
    """A potential on the game's own scale that shows as `v`."""
    from teamdata import shown
    return shown.overall_back(v)


def test_bands():
    want = {99: "A", 90: "A", 89: "B", 80: "B", 79: "C", 70: "C", 69: "D", 60: "D", 59: "F", 41: "F"}
    assert {v: grades.letter(shown_at(v)) for v in want} == want


def test_plus_and_minus_split_a_band_in_thirds():
    assert [grades.letter(shown_at(v), True) for v in (90, 92, 93, 96, 97, 99)] == ["A-", "A-", "A", "A", "A+", "A+"]
    assert [grades.letter(shown_at(v), True) for v in (80, 82, 83, 86, 87, 89)] == ["B-", "B-", "B", "B", "B+", "B+"]
    assert grades.letter(shown_at(50), True) == "F", "an F takes no plus or minus"
    assert grades.letter(140, True) == "A+" and grades.letter(-5) == "F", "a read past the scale's ends stays on it"


def test_order_and_sorting():
    assert grades.ORDER[0] == "F" and grades.ORDER[-1] == "A+"
    assert grades.place("B") > grades.place("B-") and grades.place("B+") > grades.place("B") and grades.place("A-") > grades.place("B+")
    # best first; two reads that show the same letters tie, whatever the numbers behind them
    assert grades.sort_key(["A", "A"]) < grades.sort_key(["B", "A"]) < grades.sort_key(["B", "B"])
    assert grades.sort_key(grades.span(shown_at(81), shown_at(82), False)) == grades.sort_key(grades.span(shown_at(88), shown_at(89), False))


def test_span():
    assert grades.span(shown_at(85), shown_at(94), False) == ["B", "A"] and grades.span(shown_at(88), shown_at(94), True) == ["B+", "A"]
    assert grades.span(shown_at(95), shown_at(91), True) == ["A-", "A"], "low then high, whichever way it is given"


def test_eye_unlocks_the_fine_read():
    state = {"career": {"staff": [{"evaluation": 55}, {"evaluation": grades.PLUS_MINUS_EYE}]}, "team": None}
    assert grades.fine(state)
    state["career"]["staff"][1]["evaluation"] = grades.PLUS_MINUS_EYE - 1
    assert not grades.fine(state)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("grades ok: school bands on the shown scale, a plus or minus is a third of one, reads sort by the letters shown, a sharp eye unlocks the fine read")
