"""Sorting the Prospects table (the player's report: picking Interested in You, he couldn't then sort by national rank;
and the table should sort by its columns). The sort you pick holds whatever the filter; each column's header sorts by
it, a second click the other way, the address follows. Server and browser. (Run as a file.)"""
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch          # noqa: E402
from test_ux_sweep import open_tab                           # noqa: E402

ROWS = "#tab-prospects tr.pr-row"


def server_checks() -> None:
    from coach_career import prospects
    from sim import season
    st = season.new_season("iowa", "full", seed=5, career=True)
    r = prospects.search(st, "iowa", status="interested", sort="rank", limit=50)
    ranks = [x["national_rank"] for x in r["rows"]]
    assert ranks == sorted(ranks), "Interested in You keeps the national-rank sort"
    r = prospects.search(st, "iowa", status="interested", sort="interest", limit=50)
    keen = [x["interest_in_you"] for x in r["rows"]]
    assert keen == sorted(keen, reverse=True)
    for key, field, best_first in (("ht", "height", True), ("wt", "weight", True), ("name", "name", False)):
        rows = prospects.search(st, "iowa", sort=key, limit=40)["rows"]
        vals = [x[field] for x in rows]
        assert vals == sorted(vals, reverse=best_first), (key, vals[:6])
        rows = prospects.search(st, "iowa", sort="-" + key, limit=40)["rows"]
        vals = [x[field] for x in rows]
        assert vals == sorted(vals, reverse=not best_first), ("-" + key, vals[:6])


if __name__ == "__main__":
    server_checks()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("prospects sort: server ok; browser skipped (no Playwright)")
        raise SystemExit(0)
    from sim import season
    st = season.new_season("smu", "full", seed=71, career=True)
    season.save_season(st)
    sid = st["id"]
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
            browser = launch(p)
            for width in (1280, 400):
                page = browser.new_page(viewport={"width": width, "height": 900})
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                open_tab(page, base, sid, "prospects", ROWS)
                ranks = lambda: page.eval_on_selector_all(f"{ROWS} .pr-c-rank", "els => els.map(e => parseInt(e.textContent.replace(/\\D/g, ''), 10))")
                settle = lambda: (time.sleep(0.4), page.wait_for_function("() => !document.querySelector('#tab-prospects .pr-main[aria-busy]')", timeout=30_000))
                # Interested in You, then the national rank sort holds
                page.select_option("#tab-prospects select[aria-label=Status]", "interested")
                settle()
                if page.is_visible("#tab-prospects th.pr-c-rank .pr-sort"):     # the # column (a phone hides it: the list opens by rank)
                    page.click("#tab-prospects th.pr-c-int .pr-sort")
                    settle()
                    page.click("#tab-prospects th.pr-c-rank .pr-sort")
                    settle()
                got = ranks()
                assert got and got == sorted(got), f"Interested in You sorted by national rank: {got[:8]}"
                # a header sorts; again, the other way; the address follows (no Sort menu: the headers sort)
                assert not page.query_selector("#tab-prospects select[aria-label=Sort]"), "the Sort menu is gone"
                names = lambda: page.eval_on_selector_all(f"{ROWS} .pr-c-who .pr-name, {ROWS} .pr-c-who a, {ROWS} .pr-c-who b", "els => els.map(e => e.textContent.trim().toLowerCase())")
                page.click("#tab-prospects th.pr-c-who .pr-sort")
                settle()
                assert page.get_attribute("#tab-prospects th.pr-c-who", "aria-sort") == "ascending"
                assert "psort=name" in page.url, page.url
                n1 = names()
                assert n1 and n1 == sorted(n1), n1[:6]
                page.click("#tab-prospects th.pr-c-who .pr-sort")
                settle()
                assert page.get_attribute("#tab-prospects th.pr-c-who", "aria-sort") == "descending" and "psort=-name" in page.url
                n2 = names()
                assert n2 and n2 == sorted(n2, reverse=True), n2[:6]
                assert page.text_content("#tab-prospects th.pr-c-who .pr-sort-mark") == "▼"
                # Stars: the most first on the first click (values descending)
                if page.is_visible("#tab-prospects th.pr-c-stars .pr-sort"):          # a phone hides the narrow columns
                    page.click("#tab-prospects th.pr-c-stars .pr-sort")
                    settle()
                    assert page.get_attribute("#tab-prospects th.pr-c-stars", "aria-sort") == "descending"
                    assert page.get_attribute("#tab-prospects th.pr-c-stars .pr-sort", "title") == "Sort by stars"
                if width == 400:
                    h = page.eval_on_selector("#tab-prospects th.pr-c-who .pr-sort", "e => e.getBoundingClientRect().height")
                    assert h >= 44, h
                assert not errors, errors
                page.close()
            browser.close()
    finally:
        server.terminate()
    print("prospects sort ok: Interested in You keeps the sort you pick; every column header sorts, again the other way; 1280 and 400")
