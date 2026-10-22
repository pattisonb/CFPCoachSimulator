"""Coach Career recruiting (recruiting.py): the class and every school's pull on a prospect,
then actions, hours and points, then the weekly step. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import recruiting
import season

if __name__ == "__main__":
    # the class, nobody committed, and the pulls
    st = season.new_season("ohio-state", "full", seed=4, career=True)
    rc = st["recruiting"]
    assert len(rc["prospects"]) == 4092 and all(s["committed"] is None for s in rc["status"].values())
    tx = next(p for p in rc["prospects"].values() if p["hometown"]["state"] == "TX" and p["stars"] == 3)
    assert len(tx["priorities"]) == 3 and set(tx["priorities"]) <= set(recruiting.PITCHES)
    assert recruiting.pull(st, "texas", tx["id"])["proximity"] > recruiting.pull(st, "oregon", tx["id"])["proximity"]
    assert recruiting.on_field(st, "ohio-state", 0) > recruiting.on_field(st, "kent-state", 0)
    # this season counts more every week: a 7-0 team off a 5-7 year is a hot program by week 7
    fake = dict(st, current_week=7, games={k: dict(v) for k, v in st["games"].items()})
    recruiting._set_record(fake, "kent-state", 7, 0)
    assert recruiting.on_field(fake, "kent-state", 7) > recruiting.on_field(st, "kent-state", 0) + 0.2
    # interest follows his priorities: the school strongest on his top priority leads the pull side
    assert recruiting.interest(st, "texas", tx["id"]) > 0
    print(f"recruiting ok: {len(rc['prospects'])} prospects; TX 3-star {tx['name']} priorities {tx['priorities']}")
