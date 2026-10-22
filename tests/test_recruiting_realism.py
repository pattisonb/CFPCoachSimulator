"""Coach Career recruiting held to the real classes (tools/check_recruiting.py): class sizes,
distance from home, where the blue chips go, which programs land the best classes, and when
prospects commit, sign and decommit, on two seeds. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
_sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "tools"))
import check_recruiting

if __name__ == "__main__":
    bad = []
    for seed in (1, 2):
        m = check_recruiting.measure(check_recruiting.play(seed))
        lines = check_recruiting.report(m)
        bad += [f"seed {seed}: {line.strip()}" for line in lines if line.startswith("!")]
    assert not bad, "\n" + "\n".join(bad)
    print(f"recruiting realism ok on 2 seeds: in-state {m['in_state']:.2f}, median {m['median_miles']:.0f} mi, "
          f"rank r {m['strength_rank_r']:.2f}, FCS {m['fcs_share']:.0%}")
