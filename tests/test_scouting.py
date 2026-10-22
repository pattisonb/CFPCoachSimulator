"""Coach Career scouting (recruiting.py): your staff, their areas, and reads that narrow with
looks but can be wrong. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import random
import statistics

import recruiting
import season


def coverage(st: dict, rating: int, pids: list[str]) -> tuple[float, float, list[tuple[float, bool]]]:
    """Four looks at each prospect by one evaluator: the share of ranges holding the true grade,
    the mean range width (grade points) and each (width, held) pair."""
    st["recruiting"]["reads"] = {}
    rng = random.Random(f"cov-{rating}")
    for pid in pids:
        for _ in range(4):
            recruiting.look(st, pid, rating, rng)
    rows = []
    for pid in pids:
        p = st["recruiting"]["prospects"][pid]
        for g in recruiting.GROUPS:
            lo, hi = recruiting.read_interval(st, pid, g)
            lo_l, hi_l = recruiting.grade_range(st, pid, g)
            truth = recruiting.LETTERS.index(recruiting.letter(p["truth"][g]))
            held = recruiting.LETTERS.index(hi_l) <= truth <= recruiting.LETTERS.index(lo_l)
            rows.append((hi - lo, held))
    return sum(h for _, h in rows) / len(rows), statistics.mean(w for w, _ in rows), rows


if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=7, career=True)
    rc = st["recruiting"]
    staff = st["career"]["staff"]
    assert [s["role"] for s in staff] == ["OC", "DC", "Recruiter", "Recruiter", "Recruiter"]
    assert all(s["area"] in recruiting.AREAS for s in staff) and len({s["area"] for s in staff}) == 5
    assert all(40 <= s["evaluation"] <= 99 for s in staff)
    # reads: an average evaluator holds the truth about 80%, an elite one about 90%, a weak one is
    # wider yet misses more, sometimes tight and wrong
    pids = list(rc["prospects"])[:500]
    avg, avg_w, avg_rows = coverage(st, 60, pids)
    elite, _, _ = coverage(st, 95, pids)
    weak, weak_w, weak_rows = coverage(st, 40, pids)
    assert 0.72 <= avg <= 0.88, avg
    assert 0.85 <= elite <= 0.95, elite
    assert weak < avg and weak_w > avg_w, (weak, avg, weak_w, avg_w)
    median_avg = statistics.median(w for w, _ in avg_rows)
    assert any(w < median_avg and not held for w, held in weak_rows), "a weak evaluator is never tight and wrong"
    # looks never reset when an area is reassigned; a week of scouting adds a look in every staffed area
    rc["reads"] = {}
    tx = next(pid for pid, p in rc["prospects"].items() if p["hometown"]["state"] == "TX")
    recruiter = next(s for s in staff if s["role"] == "Recruiter")
    recruiting.assign(st, recruiter["id"], "Texas") if all(s["area"] != "Texas" for s in staff) else None
    texan = next(s for s in staff if s["area"] == "Texas")
    recruiting.scout_week(st)
    looks = rc["reads"][tx]["looks"]
    assert looks == 1, looks
    recruiting.assign(st, texan["id"], "Florida")
    assert rc["reads"][tx]["looks"] == 1 and texan["area"] == "Florida"
    try:
        recruiting.assign(st, texan["id"], "Atlantis"); raise AssertionError("an unknown area was assigned")
    except recruiting.RecruitingError as e:
        assert e.code == 400
    # a hidden prospect is absent from the public list until your staff look at him
    hidden = [pid for pid, p in rc["prospects"].items() if p.get("hidden")]
    share = len(hidden) / sum(1 for p in rc["prospects"].values() if p["stars"] == 2 or (p["stars"] == 3 and p["composite"] < 0.82))
    assert 0.10 < share < 0.20, share
    h = next(pid for pid in hidden if pid not in rc["reads"])
    assert h not in recruiting.prospect_list(st)
    recruiting.look(st, h, 60, random.Random(1))
    assert h in recruiting.prospect_list(st)
    print(f"scouting ok: ranges hold the truth {weak:.0%} (40), {avg:.0%} (60), {elite:.0%} (95); "
          f"widths {weak_w:.1f} vs {avg_w:.1f}; hidden {share:.0%}")
