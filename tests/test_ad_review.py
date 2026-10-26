"""The yearly meeting with your athletic director (coach_career/offseason.py review): at the
Departures step the AD gives his verdict on your season; on the hot seat you can make your case,
offer a change on your staff or ask for one more year, and the firing (only at the end of a
season) is decided there. Fired, you walk the offseason on Auto and pick your next job at the
Staff step. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import carousel, offseason
from sim import season
from test_offseason import finished


def fresh(security: int):
    st = season.new_season("ohio-state", "full", seed=7, career=True)
    finished(st)
    from coach_career import league as lg
    st["league"] = lg.from_base(season.season_year(st) + 1)
    t = st["league"]["teams"]["ohio-state"]
    t["ad"] = {"patience": 3, "security": security}
    t["coaches"]["head_coach"]["since"] = 2020
    return st


if __name__ == "__main__":
    # a champion: the review is a pat on the back, nothing to decide
    st = fresh(70)
    off = offseason.start(st)
    rv = off["review"]
    assert rv["security"] >= 70 and rv["mood"] in ("Secure", "Untouchable") and rv["risk"] == "none" and rv["decided"], rv
    assert rv["record"] and rv["goal"] and rv["met"] in (True, False) and rv["outcome"]
    # a coach deep on the hot seat (a title does not save a security that low): the AD decides,
    # and asking for one more year survives it with an ultimatum
    st = fresh(2)
    off = offseason.start(st)
    rv = off["review"]
    assert rv["risk"] == "fire" and not rv["decided"] and set(rv["options"]) >= {"case", "change", "year", "nothing"}, rv
    try:
        offseason.advance(st); raise AssertionError("advanced past an undecided review")
    except offseason.ReviewError:
        pass
    offseason.review_decide(st, "year")
    assert rv["decided"] and not rv["fired"] and rv["outcome"] and "ultimatum" in rv["outcome"].lower(), rv
    assert st["league"]["teams"]["ohio-state"]["ad"]["ultimatum"] == off["year"] + 1
    assert carousel.status(st)["ultimatum"]
    # offer a change: your coordinator goes (he joins the market, his job opens at the Staff step)
    st = fresh(25)
    off = offseason.start(st)
    rv = off["review"]
    assert rv["risk"] == "warning" and not rv["decided"], rv["security"]
    n = len(carousel.market(st)["coaches"])
    offseason.review_decide(st, "change", staff_id="dc")
    assert rv["decided"] and not rv["fired"] and rv["security"] > 25, rv
    assert len(carousel.market(st)["coaches"]) == n + 1
    st["offseason"]["auto"] = True
    while off["stage"] != "staff":
        offseason.advance(st)
    assert "dc" in off["staff"]["leaving"] and len(off["staff"]["candidates"]["dc"]) >= 4
    # fired at the review (a security that low leaves the AD no choice): the rest of the offseason
    # runs itself, the Staff step offers openings
    st = fresh(-10)
    off = offseason.start(st)
    offseason.review_decide(st, "nothing")
    rv = off["review"]
    assert rv["decided"] and rv["fired"], rv
    while off["stage"] != "staff":
        offseason.advance(st)
    car = off["carousel"]
    assert car["you"]["fired"] and car["openings"], car["you"]
    try:
        offseason.retain(st, "x", "meet"); raise AssertionError("a fired coach can still act")
    except (offseason.RetentionError, ValueError):
        pass
    offseason.choose_job(st, car["openings"][0])
    offseason.advance(st)
    new = offseason.next_season(st)
    assert new["team"] == car["openings"][0]
    assert any(c["team"] == "ohio-state" and c["reason"] == "fired" for c in off["coaching_changes"])
    season.close_pool()
    print("ad review ok")
