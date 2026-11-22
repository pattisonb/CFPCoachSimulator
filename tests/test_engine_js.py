"""The JavaScript engine (engine_js/) plays the Python engine's games, number for number.

Python's `random` and `round` as engine_js/pyrt.js has them, against Python's own answers; then a run of seeded games
(tools/engine_reference.py) through engine_js/test/compare.mjs, which holds every field of every result to Python's.
Needs `node` on the path. `python3 tests/test_engine_js.py [games]`"""
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


def main() -> None:
    games = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    with tempfile.TemporaryDirectory(prefix="cfp-engine-js-") as tmp:
        expected = Path(tmp) / "pyrt.json"
        expected.write_text(json.dumps(runtime_answers()), encoding="utf-8")
        r = subprocess.run(["node", str(ROOT / "engine_js" / "test" / "pyrt_check.mjs"), str(expected)], capture_output=True, text=True)
        assert r.returncode == 0, "pyrt.js is not Python's random and round:\n" + r.stdout[-2000:] + r.stderr[-2000:]
        runtime = r.stdout.strip().splitlines()[-1]
        ref = Path(tmp) / "games.json"
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "engine_reference.py"), str(ref), str(games), "5000"], capture_output=True, text=True, cwd=ROOT)
        assert r.returncode == 0, r.stderr[-2000:]
        r = subprocess.run(["node", str(ROOT / "engine_js" / "test" / "compare.mjs"), str(ref)], capture_output=True, text=True)
        assert r.returncode == 0, "the JavaScript engine does not play Python's games:\n" + r.stdout[-3000:] + r.stderr[-2000:]
        print(f"engine js ok: {runtime}; {r.stdout.strip().splitlines()[-1]}")


if __name__ == "__main__":
    main()
