"""Run every test in this folder, each as its own process (the season engine uses
multiprocessing, which on Windows cannot start workers from a piped script), and print a
pass/fail line per test: `python tests/run_all.py [name ...]`."""
import os
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SLOW = {"test_bowls.py", "test_awards.py", "test_review.py"}   # full seasons: a few minutes each

SEASONS = ROOT / "data" / "seasons"


def _saves() -> set:
    return set(os.listdir(SEASONS)) if SEASONS.is_dir() else set()


if __name__ == "__main__":
    wanted = set(sys.argv[1:])
    tests = sorted(p for p in HERE.glob("test_*.py") if not wanted or p.stem in wanted or p.name in wanted)
    failed = []
    before = _saves()        # the saves the tests write (every one a new uuid) are removed at the end: a run was 26 GB once
    for t in tests:
        t0 = time.perf_counter()
        # UTF-8 output: team and player names such as Hawaiʻi do not fit the Windows console code page
        r = subprocess.run([sys.executable, str(t)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        dt = time.perf_counter() - t0
        ok = r.returncode == 0
        print(f"{'PASS' if ok else 'FAIL'}  {t.name:<26} {dt:6.1f}s  {(r.stdout.strip().splitlines() or [''])[-1][:90]}")
        if not ok:
            failed.append(t.name)
            print(r.stdout[-1500:], r.stderr[-1500:], sep="\n")
    import shutil
    for name in _saves() - before:
        path = SEASONS / name
        shutil.rmtree(path, ignore_errors=True) if path.is_dir() else path.unlink(missing_ok=True)
        for league_file in (ROOT / "data" / "leagues").glob(f"{path.stem}-*.json"):   # its league teams files too: these were 2.6 GB of leftovers once
            league_file.unlink(missing_ok=True)
    print(f"\n{len(tests) - len(failed)} of {len(tests)} passed")
    sys.exit(1 if failed else 0)
