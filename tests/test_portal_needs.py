"""Your Needs in the transfer portal (the player's report: the hover said "0 committed" with a high school class
signed). In the portal your signed class sits on next year's roster, so the needs name them apart: each group says
how many signed from high school, how many return, and the transfer commits. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
from app import api                                    # noqa: E402
from coach_career import recruiting                    # noqa: E402
from tests.test_portal_profile import to_portal        # noqa: E402

ME = "ohio-state"


def test_signees_named_in_the_portal():
    sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
    to_portal(sid)
    st = api.loaded_state()
    assert recruiting.is_portal(st)
    last = st["recruiting_last"]
    signed = [pid for pid, s in last["status"].items() if s.get("signed") == ME]
    assert signed, "the class signed someone"
    nd = recruiting.needs_detail(st, ME)
    total = sum(r["signees"] for r in nd.values())
    assert all(r["portal"] for r in nd.values())
    assert total > 0 and total <= len(signed), (total, len(signed))
    for g, r in nd.items():
        assert 0 <= r["signees"] <= r["back"], (g, r)


def test_season_needs_unchanged():
    sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
    st = api.loaded_state()
    nd = recruiting.needs_detail(st, ME)
    assert all("signees" not in r and "portal" not in r for r in nd.values()), "the season's needs read as before"


if __name__ == "__main__":
    test_signees_named_in_the_portal()
    test_season_needs_unchanged()
    print("portal needs ok: the portal's needs name your signed high school class apart from who returns")
