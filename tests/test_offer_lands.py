"""An offer lands at the week step, as a call does (the player's ask): his board row says the offer is on its way
(`offer_landing`) until the week advances, so the page shows "Offer Sent", not "Clear Favorite", the moment you offer.
(Run as a file.)"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from coach_career import prospects, recruiting   # noqa: E402
from sim import season                            # noqa: E402

ME = "iowa"


def test_offer_lands_at_the_week_step():
    st = season.new_season(ME, "full", seed=11, career=True)
    rc = st["recruiting"]
    pid = next(q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[40:] if not rc["prospects"][q].get("hidden"))
    recruiting.set_board(st, pid, True)
    assert prospects.board_row(st, pid, ME)["offer_landing"] is False, "no offer: nothing on its way"
    recruiting.act(st, ME, pid, "offer", pitch="winning", nil=0)
    row = prospects.board_row(st, pid, ME)
    assert row["offered"] and row["offer_landing"], row.get("offer_landing")
    recruiting.weekly_step(st, st["current_week"])
    st["current_week"] += 1                       # the season's advance moves the week on
    row = prospects.board_row(st, pid, ME)
    assert row["offered"] and not row["offer_landing"], "the week step lands it"


def test_ai_offers_never_marked():
    st = season.new_season(ME, "full", seed=11, career=True)
    recruiting.weekly_step(st, st["current_week"])
    assert not (st["recruiting"].get("offer_landing") or {}), "only your offers are marked"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
