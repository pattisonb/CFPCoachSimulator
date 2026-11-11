"""A transfer's call and head coach visit read like the portal, not high school (the player's ask: "in transfer
portal players should reference their last school or last year's stats or stuff depending on why they transferred").
The season is over, so no "Saturday" game talk and no living room: you open on his portal entry, he says why he left
his last school (by name), and a visit's family line is about his move. The high school scenes are untouched.
(Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
from app import api                                    # noqa: E402
from coach_career import scenes                        # noqa: E402
from tests.test_portal_profile import to_portal        # noqa: E402

ME = "ohio-state"
HS_ONLY = ("Saturday", "having me", "your home", "opening your home", "living room", "practice", "locker room", "Have you eaten")


def test_portal_scenes():
    sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
    to_portal(sid)
    st = api.loaded_state()
    rc = st["recruiting"]
    pids = [q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]) if rc["prospects"][q]["from"] != ME][:40]
    whys = set()
    for i, pid in enumerate(pids):
        p = rc["prospects"][pid]
        action = "hc_visit" if i % 2 else "call"
        sc = scenes.open_scene(st, ME, pid, action, st["current_week"])
        text = " ".join(t["text"] for t in sc["turns"])
        assert not any(w in text for w in HS_ONLY), (action, text)
        him = [t["text"] for t in sc["turns"] if t["who"] == "him"]
        assert him and (p["from_name"] in him[0] or him[0] in [x for v in scenes.CONTEXT.values() for x in v] or him[0] == scenes.HEARD_RIVAL), him
        assert "{" not in text and "None" not in text and "undefined" not in text, text
        assert not ("didn't get many snaps" in text and "pay for it" in text), text
        whys.add(scenes.portal_fields(st, p)["why"])
        if action == "hc_visit":
            assert sc["turns"][0]["who"] == "note"
    assert len(whys) >= 2, f"the reasons vary: {whys}"


def test_numbers_in_words():
    p = {"id": "x", "line": {"games": 12, "started": 12, "stats": {"pass_yards": 2841, "passing_touchdowns": 22}}, "from_name": "Akron", "usage": "starter"}
    f = scenes.portal_fields({}, p)
    assert f["did"] == "I had 2,841 passing yards and 22 touchdown passes" and f["why"] == "starter", f
    q = {"id": "y", "line": {"games": 0, "started": 0, "stats": {}}, "from_name": "Akron", "usage": "bench"}
    assert scenes.portal_fields({}, q)["did"] == "I didn't get many snaps"


if __name__ == "__main__":
    test_numbers_in_words()
    test_portal_scenes()
    print("portal scenes ok: a transfer's call and visit open on his portal entry and say why he left his last school; no high school lines")
