"""Coach Career recruiting held to the real classes (tools/check_recruiting.py): class sizes,
distance from home, where the blue chips go, which programs land the best classes, and when
prospects commit, sign and decommit, on two seeds. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
_sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "tools"))
import check_recruiting
from coach_career import prospects

if __name__ == "__main__":
    bad = []
    gen_signed = []                    # (prospect, his class's rank at the school he signed with)
    for seed in (1, 2):
        state = check_recruiting.play(seed)
        crc = prospects.class_rc(state)
        gen_signed += [(pid, prospects.class_rank(state, crc["status"][pid]["signed"]) if crc["status"][pid]["signed"] != "FCS" else 999)
                       for pid in crc.get("generational", [])]
        m = check_recruiting.measure(state)
        lines = check_recruiting.report(m)
        bad += [f"seed {seed}: {line.strip()}" for line in lines if line.startswith("!")]
    assert not bad, "\n" + "\n".join(bad)
    if gen_signed:                     # a generational prospect signs with a top-25 class
        top = sum(1 for _, r in gen_signed if r <= 25)
        assert top >= 0.8 * len(gen_signed), f"generational prospects signing with a top-25 class: {top}/{len(gen_signed)}: {gen_signed}"
    print(f"recruiting realism ok on 2 seeds: in-state {m['in_state']:.2f}, median {m['median_miles']:.0f} mi, "
          f"rank r {m['strength_rank_r']:.2f}, FCS {m['fcs_share']:.0%}")
