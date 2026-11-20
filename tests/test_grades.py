"""Letter grades for overall potential (coach_career/grades.py): the bands, the plus and minus, how reads sort."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import grades


def test_bands():
    want = {99: "A", 80: "A", 79: "B", 60: "B", 59: "C", 40: "C", 39: "D", 20: "D", 19: "F", 0: "F"}
    assert {v: grades.letter(v) for v in want} == want


def test_plus_and_minus_split_a_band_in_thirds():
    assert [grades.letter(v, True) for v in (80, 86, 87, 92, 93, 99)] == ["A-", "A-", "A", "A", "A+", "A+"]
    assert [grades.letter(v, True) for v in (60, 66, 67, 72, 73, 79)] == ["B-", "B-", "B", "B", "B+", "B+"]
    assert grades.letter(10, True) == "F", "an F takes no plus or minus"
    assert grades.letter(140, True) == "A+" and grades.letter(-5) == "F", "a read past the scale's ends stays on it"


def test_order_and_sorting():
    assert grades.ORDER[0] == "F" and grades.ORDER[-1] == "A+"
    assert grades.place("B") > grades.place("B-") and grades.place("B+") > grades.place("B") and grades.place("A-") > grades.place("B+")
    # best first; two reads that show the same letters tie, whatever the numbers behind them
    assert grades.sort_key(["A", "A"]) < grades.sort_key(["B", "A"]) < grades.sort_key(["B", "B"])
    assert grades.sort_key(grades.span(61, 62, False)) == grades.sort_key(grades.span(78, 79, False))


def test_span():
    assert grades.span(75, 91, False) == ["B", "A"] and grades.span(75, 91, True) == ["B+", "A"]
    assert grades.span(88, 84, True) == ["A-", "A"], "low then high, whichever way it is given"


def test_eye_unlocks_the_fine_read():
    state = {"career": {"staff": [{"evaluation": 55}, {"evaluation": grades.PLUS_MINUS_EYE}]}, "team": None}
    assert grades.fine(state)
    state["career"]["staff"][1]["evaluation"] = grades.PLUS_MINUS_EYE - 1
    assert not grades.fine(state)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("grades ok: five 20-point bands, a plus or minus is a third of one, reads sort by the letters shown, a sharp eye unlocks the fine read")
