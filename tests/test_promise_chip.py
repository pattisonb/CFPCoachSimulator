"""Promises judged all season, in the browser (docs/superpowers/plans/2026-11-11-promises-judged-all-season.md, Task 4):
a second-season career with a promised starter and a promised bench player, two weeks played. The depth chart and the
player page show each promise's chip (On Track, Slipping, Broken) and the Office's Program News carries the bench
player's "Coach, you told me this was my job." `python3 tests/test_promise_chip.py` (skipped without Playwright)."""
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch   # noqa: E402
from test_ux_sweep import open_tab   # noqa: E402


def career():
    from coach_career import promises
    from sim import season
    import test_promises
    st = test_promises.second_season()
    qb, bench, row = test_promises.promise_two(st)
    season.advance(st)
    season.advance(st)
    season.advance(st)
    season.save_season(st)
    chips = promises.chips_now(st)
    return st, qb, bench, row, chips


def run(base, st, qb, bench, row, chips, browser) -> None:
    sid = st["id"]
    for width in (1280, 400):
        page = browser.new_page(viewport={"width": width, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        # the player page: his chip in the tags
        page.goto(f"{base}/index.html?" + urllib.parse.urlencode([("id", sid), ("tab", "office"), ("modal", f"player:{st['team']}|{row['name']}|{row['position']}|{bench}")]))
        page.wait_for_selector(".modal:not([hidden]) .player-page", timeout=60_000)
        tag = page.inner_text(".modal:not([hidden]) .player-tags")
        assert chips[bench] in tag, (tag, chips[bench])
        page.click(".modal:not([hidden]) .modal-close")
        # the depth chart's list: the chip beside his name
        open_tab(page, base, sid, "depth", ".dc-card")
        found = page.evaluate("() => [...document.querySelectorAll('.dc-promise')].map(e => e.textContent.trim())")
        assert "On Track" in found, found                   # the field shows the starters: the promised QB's chip (the bench player's is on his page above)
        # the Office: his line in Program News
        page.goto(f"{base}/index.html?id={sid}&tab=office")
        page.wait_for_selector(".ofc-news .ofc-feed", timeout=120_000)
        news = page.inner_text(".ofc-news")
        assert "Coach, you told me this was my job." in news and row["name"] in news, news[:400]
        assert not errors, errors
        page.close()


if __name__ == "__main__":
    import urllib.parse
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("promise chip skipped: Playwright is not installed")
        raise SystemExit(0)
    from coach_career import league
    st, qb, bench, row, chips = career()
    assert chips.get(qb) == "On Track" and chips.get(bench) in ("Slipping", "Broken"), chips
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(base + "/api/teams", timeout=2)
                break
            except OSError:
                time.sleep(0.5)
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"promise chip skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            run(base, st, qb, bench, row, chips, browser)
            browser.close()
        print("promise chip ok: the depth chart and the player page show each promise's chip; Program News carries his line; 1280 and 400")
    finally:
        try:
            call(base, f"/api/season/{st['id']}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        league.forget(st["id"])
        server.terminate()
