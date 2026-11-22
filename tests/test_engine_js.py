"""Python's `random` and `round` as the JavaScript engine has them (engine_js/pyrt.js), against Python's own answers.
The engine draws its numbers the way the Python engine it replaced did, so every game it plays is the game that engine
played (tests/test_sim_golden.py and tests/test_play_log.py hold its games to that engine's results); this holds the
two things underneath: the same random numbers from the same seed, and rounding halves to the even neighbor.
Needs `node` on the path. `python3 tests/test_engine_js.py`"""
import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def runtime_answers() -> dict:
    out = {"rng": [], "round": []}
    for seed in (0, 1, 42, 7919, 2**31, 2**32 - 1, 2**32, 2**40 + 7, 123456789012, 999999999999999):
        r = random.Random(seed)
        seq = []
        for i in range(400):
            k = i % 9
            if k == 0: seq.append(r.random())
            elif k == 1: seq.append(r.randint(1, 6 + i))
            elif k == 2: seq.append(r.gauss(3.5, 2.25))
            elif k == 3: seq.append(r.choices(list(range(7)), weights=[0.1, 2, 3.3, 0.7, 5, 1e-3, 2.2])[0])
            elif k == 4: seq.append(r.choice(list(range(11))))
            elif k == 5: seq.append(r.uniform(-3, 9.5))
            elif k == 6: seq.append(r.gammavariate(2.2 + (i % 5) * 0.4, 1.7))
            elif k == 7: seq.append(r.choices(list(range(5)), k=3))
            else: seq.append(r.randint(-40, 1000000))
        r.seed(seed + 3)
        seq += [r.gauss(0, 1), r.gammavariate(0.6, 2.0), r.gammavariate(1.0, 2.0)]
        out["rng"].append({"seed": seed, "seq": seq})
    r = random.Random(5)
    xs = [0.5, 1.5, 2.5, -0.5, -1.5, 2.675, 0.125, 0.375, 1.005, 2.5000000001, 1e-7, 123456.785, -2.675, 0.045, 1.15, 8.345, 99.995, 0.0, 3.0, -7.5, 0.285, 1234.5, 1234.4999999]
    xs += [r.uniform(-200, 200) for _ in range(3000)] + [round(r.uniform(-50, 50), 2) + 0.005 for _ in range(2000)] + [r.randint(-300, 300) / 8 for _ in range(1500)]
    out["round"] = [[x, round(x), round(x, 1), round(x, 2), round(x, 3), round(x, 6)] for x in xs]
    return out


def more_answers() -> dict:
    """Generators seeded with text (the season and recruiting code's), shuffle and sample, and `statistics`."""
    import statistics as st
    out = {"seed": [], "stat": []}
    for s in ["", "a", "auto-11-smu-3", "recruiting-0-12", "hidden-2027-11-r2027-0042", "staff-0-ohio-state", "x" * 200,
              "ünïcödé-ñ-日本", "class-2027-7", "twists", "0", "abc" * 50 + "z"]:
        r = random.Random(s)
        a = [r.random(), r.randint(0, 10**6), r.gauss(0, 1), r.random()]
        xs = list(range(40))
        r.shuffle(xs)
        out["seed"].append([s, a, xs, r.sample(list(range(100)), 7), r.sample(list(range(12)), 5), r.sample(list(range(5000)), 30), r.randrange(1 << 30)])
    r = random.Random(9)
    for i in range(400):
        n, kind = r.randint(1, 60), i % 4
        xs = ([r.randint(60, 330) for _ in range(n)] if kind == 0 else [r.uniform(-50, 50) for _ in range(n)] if kind == 1
              else [round(r.uniform(0, 99), 1) for _ in range(n)] if kind == 2 else [r.choice([70, 71, 72.5, 73]) for _ in range(n)])
        out["stat"].append([xs, st.mean(xs), st.pstdev(xs), st.median(xs), st.fmean(xs)])
    return out


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="cfp-engine-js-") as tmp:
        expected = Path(tmp) / "pyrt.json"
        expected.write_text(json.dumps(runtime_answers()), encoding="utf-8")
        r = subprocess.run(["node", str(ROOT / "engine_js" / "test" / "pyrt_check.mjs"), str(expected)], capture_output=True, text=True)
        assert r.returncode == 0, "pyrt.js is not Python's random and round:\n" + r.stdout[-2000:] + r.stderr[-2000:]
        first = r.stdout.strip().splitlines()[-1]
        expected.write_text(json.dumps(more_answers()), encoding="utf-8")
        r = subprocess.run(["node", str(ROOT / "engine_js" / "test" / "pyrt_more.mjs"), str(expected)], capture_output=True, text=True)
        assert r.returncode == 0, "pyrt.js / pystat.js are not Python's text seeds, shuffle, sample or statistics:\n" + r.stdout[-2000:] + r.stderr[-2000:]
        print("engine js ok:", first + ";", r.stdout.strip().splitlines()[-1])


if __name__ == "__main__":
    main()
