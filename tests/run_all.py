"""Run every test in this folder, each as its own process (the season engine uses
multiprocessing, which on Windows cannot start workers from a piped script), and print a
pass/fail line per test: `python tests/run_all.py [--strict] [--retry N] [name ...]`.

--strict (or CFP_STRICT=1): a test that skips for want of Playwright or a Chromium fails instead
of passing (CI must run the browser tests, not skip them). --retry N: a failed test runs again up
to N times; one that then passes is reported as FLAKY (it still passes the run). With
GITHUB_STEP_SUMMARY set, the result table is written there too."""
import os
import pathlib
import re
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SLOW = {"test_bowls.py", "test_awards.py", "test_review.py", "test_site_bundle.py"}   # full seasons (the bundle: a week, an offseason, a week): a few minutes each

SEASONS = ROOT / "data" / "seasons"


def _saves() -> set:
    return set(os.listdir(SEASONS)) if SEASONS.is_dir() else set()


SKIP_NO_BROWSER = re.compile(r"\bskipped\b.*(Playwright|Chromium)", re.I)


def _run(t: pathlib.Path) -> tuple[bool, float, str, str]:
    t0 = time.perf_counter()
    # UTF-8 output: team and player names such as Hawaiʻi do not fit the Windows console code page
    r = subprocess.run([sys.executable, str(t)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    last = (r.stdout.strip().splitlines() or [""])[-1]
    ok = r.returncode == 0
    if ok and STRICT and SKIP_NO_BROWSER.search(last):
        ok, last = False, f"STRICT: skipped is a failure here: {last}"
    return ok, time.perf_counter() - t0, last, (r.stdout[-1500:] + "\n" + r.stderr[-1500:])


if __name__ == "__main__":
    args = sys.argv[1:]
    STRICT = os.environ.get("CFP_STRICT") == "1"
    retries = 0
    if "--strict" in args:
        STRICT = True
        args.remove("--strict")
    if "--retry" in args:
        i = args.index("--retry")
        retries = int(args[i + 1])
        del args[i:i + 2]
    wanted = set(args)
    tests = sorted(p for p in HERE.glob("test_*.py") if not wanted or p.stem in wanted or p.name in wanted)
    failed, flaky, rows = [], [], []
    before = _saves()        # the saves the tests write (every one a new uuid) are removed at the end: a run was 26 GB once
    for t in tests:
        ok, dt, last, tail = _run(t)
        print(f"{'PASS' if ok else 'FAIL'}  {t.name:<26} {dt:6.1f}s  {last[:90]}", flush=True)
        tries = 0
        while not ok and tries < retries:
            tries += 1
            print(tail)
            print(f"RETRY {t.name} ({tries} of {retries})", flush=True)
            ok, dt, last, tail = _run(t)
            print(f"{'PASS' if ok else 'FAIL'}  {t.name:<26} {dt:6.1f}s  {last[:90]}", flush=True)
            if ok:
                flaky.append(t.name)
        if not ok:
            failed.append(t.name)
            print(tail)
        rows.append((t.name, "FLAKY" if t.name in flaky else "PASS" if ok else "FAIL", dt, last))
    import shutil
    for name in _saves() - before:
        path = SEASONS / name
        shutil.rmtree(path, ignore_errors=True) if path.is_dir() else path.unlink(missing_ok=True)
        for league_file in (ROOT / "data" / "leagues").glob(f"{path.stem}-*.json"):   # its league teams files too: these were 2.6 GB of leftovers once
            league_file.unlink(missing_ok=True)
    print(f"\n{len(tests) - len(failed)} of {len(tests)} passed" + (f" ({len(flaky)} flaky: {', '.join(flaky)})" if flaky else ""))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"### Tests: {len(tests) - len(failed)} of {len(tests)} passed" + (f", {len(flaky)} flaky" if flaky else "") + "\n\n")
            f.write("| Test | Result | Seconds | Last line |\n|---|---|---|---|\n")
            for name, res, dt, last in rows:
                f.write(f"| {name} | {res} | {dt:.0f} | {last[:90].replace('|', '/')} |\n")
    sys.exit(1 if failed else 0)
