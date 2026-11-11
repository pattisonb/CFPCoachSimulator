"""Last year's transfers are not this year's (the player's report: the picker's Transfers group still listed players who
transferred in a year ago). A transfer is stamped with the offseason he came; only this offseason's are named
transfers. An older save without the stamp reads this offseason's portal moves. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
from coach_career import offseason      # noqa: E402


def test_new_transfer():
    off = {"year": 2028, "portal": {"moves": [{"id": "b", "to": "iowa"}, {"id": "c", "to": "ohio-state"}]}}
    assert offseason._new_transfer(off, {"id": "a", "transfer": "ucla", "transfer_year": 2028}, "iowa")
    assert not offseason._new_transfer(off, {"id": "a", "transfer": "ucla", "transfer_year": 2027}, "iowa"), "last year's"
    assert offseason._new_transfer(off, {"id": "b", "transfer": "ucla"}, "iowa"), "an old save: this year's moves"
    assert not offseason._new_transfer(off, {"id": "c", "transfer": "ucla"}, "iowa"), "an old save: not his move to you"
    assert not offseason._new_transfer(off, {"id": "d", "transfer": "ucla"}, "iowa"), "an old save: last year's"
    assert not offseason._new_transfer(off, {"id": "e"}, "iowa"), "never a transfer"


if __name__ == "__main__":
    test_new_transfer()
    print("transfer year ok: only this offseason's transfers are named transfers")
