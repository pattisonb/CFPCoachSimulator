"""Clear Mode (coach_career/clear.py), the branch's switch on: what replaced the word-mode screens and conversations
(their own tests run with CFP_CLEAR=0). A pitched topic gets a plain Yes or No; a complete report leaves no guesswork
(his priorities, personality, decider and style known); his key ratings and potential read as ranges of numbers that
narrow with every look, with a confidence word. (Run as a file.)"""
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from coach_career import clear, persona, prospects, recruiting, scenes   # noqa: E402
from sim import season   # noqa: E402

ME = "ohio-state"
LEAKS = re.compile(r"\b(undefined|null|NaN)\b|\bNone\b(?! Yet| Stand Out)")


def scout(st: dict, pid: str):
    st["recruiting"]["hours"][ME] = 100
    st["recruiting"]["scout_points"] = {ME: 100}
    return recruiting.act(st, ME, pid, "scout")


def pick(st: dict, n: int = 40) -> str:
    rc = st["recruiting"]
    return next(q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[n:]
                if not rc["prospects"][q].get("hidden") and q in recruiting.visible(st))


def check_api(st: dict) -> str:
    assert clear.on(), "Clear Mode is the branch's default"
    rc = st["recruiting"]
    pid = pick(st)
    p = rc["prospects"][pid]
    # a pitched topic: Yes (one of his priorities, with your case there in a word) or No
    yes = next(t for t in p["priorities"] if t in scenes._TOPIC_NAME)
    no = next(t for t in scenes._TOPIC_NAME if not persona.counts_as_priority(st, pid, t))
    r_yes, r_no = scenes._reaction_clear(st, ME, pid, yes, False), scenes._reaction_clear(st, ME, pid, no, False)
    assert re.fullmatch(r".+: Yes, one of his priorities\. Your case there: (Strong|Fair|Weak)\.", r_yes["text"]), r_yes
    assert r_no["text"] == f"{scenes._TOPIC_NAME[no]}: No, not one of his priorities." and r_no["kind"] == "polite", r_no
    # ratings: none before a look; after each look a range of numbers that never widens, with a confidence word
    assert clear.ratings(st, pid) is None
    widths = []
    for _ in range(3):
        scout(st, pid)
        r = clear.ratings(st, pid)
        rows = r["rows"] + [r["potential"]]
        assert 4 <= len(r["rows"]) <= 8 and r["potential"]["label"].startswith("Potential at "), r
        for x in rows:
            assert 1 <= x["lo"] < x["hi"] <= 99 and x["lo"] <= x["est"] <= x["hi"], x        # always a range, never one number
            assert x["confidence"] in ("High", "Medium", "Low"), x
        widths.append(sum(x["hi"] - x["lo"] for x in rows))
    assert widths[0] >= widths[1] >= widths[2], f"a read narrows with every look: {widths}"
    assert r["complete"], r
    # a complete report: his priorities, personality, decider and style all known
    told = (rc["revealed"].get(ME) or {}).get(pid) or []
    assert set(p["priorities"]) <= set(told), (p["priorities"], told)
    known = persona.known(st, ME, pid)
    assert all(known.get(t) for t in ("personality", "decider", "style")), known
    view = prospects.profile(st, pid, ME)
    assert view["clear"] and view["abilities"] is not None, "the profile carries Key Ratings and his abilities once scouted"
    assert not LEAKS.search(str(view["clear"])), view["clear"]
    return pid


if __name__ == "__main__":
    st = season.new_season(ME, "full", seed=11, career=True)
    check_api(st)
    season.close_pool()
    print("clear mode ok: Yes or No on a pitch, a complete report leaves no guesswork, Key Ratings and Potential as narrowing "
          "ranges with a confidence word")
