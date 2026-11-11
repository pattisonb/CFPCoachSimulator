"""Custom Programs on the page: create a program (name, colors, conference, three players), check it, reload and it is
still there, download it as a league file, edit a real program; then on New Career check it, see the summary with the
scheduling note, pick it and start a career at it. Needs Playwright with a Chromium; skipped without one."""
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import free_port, launch   # noqa: E402

if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("custom programs page test skipped: Playwright is not installed")
        raise SystemExit(0)
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
                print(f"custom programs page test skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/programs.html")
            page.wait_for_function("() => document.querySelectorAll('#pg-real option').length > 100", timeout=120_000)
            # create a program
            page.click("#pg-new")
            ed = "#pg-editor"
            page.wait_for_selector(f"{ed}:not([hidden])")
            # checks as you type: no name or conference yet, so Check Program waits and says why
            assert page.is_disabled(f"{ed} button:has-text('Check Program')")
            probs = page.inner_text(f"{ed} .pg-problems")
            assert "Give the program a name." in probs and "Pick a conference." in probs, probs
            assert page.query_selector(f"{ed} .pg-field.pg-invalid[data-key=name]")
            page.fill(f"{ed} .pg-field:has-text('Name') input >> nth=0", "Alder Tech")
            page.fill(f"{ed} .pg-field:has-text('Mascot') input", "Owls")
            page.fill(f"{ed} .pg-field:has-text('City') input", "Bend")
            page.select_option(f"{ed} .pg-field:has-text('State') select", "OR")
            # the campus on the map: unset says what the game uses; a click near Bend sets the spot (and the state)
            assert "Click the map" in page.inner_text(f"{ed} .pg-spot") and page.is_hidden(f"{ed} .pg-spot-clear")
            assert page.eval_on_selector(f"{ed} .pg-map-state.on", "e => e.dataset.state") == "OR", "the state is lit"
            page.select_option(f"{ed} .pg-field:has-text('State') select", "WA")
            xy = page.evaluate("""() => { const svg = document.querySelector('#pg-editor .pg-map'), r = svg.getBoundingClientRect();
              const [x, y] = window.USMap.project([44.06, -121.31]); return [r.left + x * r.width / 975, r.top + y * r.height / 610]; }""")
            page.mouse.click(xy[0], xy[1])
            spot = page.inner_text(f"{ed} .pg-spot-note")
            import re
            m = re.match(r"Campus at ([\d.]+)° N, ([\d.]+)° W\. ", spot)
            assert m and abs(float(m[1]) - 44.06) < 0.3 and abs(float(m[2]) - 121.31) < 0.3 and spot.endswith("."), spot
            assert page.eval_on_selector(f"{ed} .pg-field:has-text('State') select", "e => e.value") == "OR", "the click sets the state"
            assert page.is_visible(f"{ed} .pg-spot-clear")
            page.select_option(f"{ed} .pg-field:has-text('Conference') select >> nth=0", "mountain-west")
            page.fill(f"{ed} textarea", "Jay Smith, QB, JR\nMax Lee, WR, SO, 74")
            # one at a time: the Add Player row adds to the list (and the paste box); x removes one
            page.fill(f"{ed} .pg-add input[name=pname]", "Al Cruz")
            page.select_option(f"{ed} .pg-add select[name=ppos]", "LT")
            page.select_option(f"{ed} .pg-add select[name=pcls]", "SR")
            page.click(f"{ed} .pg-add button:has-text('Add Player')")
            page.fill(f"{ed} .pg-add input[name=pname]", "Cut Me")
            page.select_option(f"{ed} .pg-add select[name=ppos]", "K")
            page.click(f"{ed} .pg-add button:has-text('Add Player')")
            names = page.eval_on_selector_all(f"{ed} .pg-player b", "els => els.map(e => e.textContent)")
            assert names == ["Jay Smith", "Max Lee", "Al Cruz", "Cut Me"], names
            page.click(f"{ed} .pg-player:has-text('Cut Me') .pg-player-x")
            assert page.eval_on_selector_all(f"{ed} .pg-player b", "els => els.map(e => e.textContent)") == ["Jay Smith", "Max Lee", "Al Cruz"]
            assert "Al Cruz, LT, SR" in page.input_value(f"{ed} textarea"), "the paste box follows the list"
            page.fill(f"{ed} .pg-field:has-text('Offensive Coordinator') input", "Sam Roe")
            page.fill(f"{ed} .pg-field:has-text('Defensive Coordinator') input", "Lee Poe")
            page.select_option(f"{ed} .pg-field:has-text('Offense') select", "Spread RPO")
            page.select_option(f"{ed} .pg-field:has-text('Defense') select", "4-3")
            # rivals: search, pick (a chip), name one; the fourth is refused (three at most)
            for q, slug in (("boise", "boise-state"), ("air force", "air-force")):
                page.fill(f"{ed} .pg-rival-search", q)
                page.click(f"{ed} .pg-rival-hit[data-slug='{slug}']")
            page.fill(f"{ed} .pg-rival[data-slug='boise-state'] .pg-rival-name", "Battle for the Bell")
            page.select_option(f"{ed} .pg-rival[data-slug='boise-state'] .pg-rival-often", "week")
            assert page.eval_on_selector(f"{ed} .pg-rival[data-slug='air-force'] .pg-rival-often option[value=week]", "o => o.disabled"), "one rivalry week game"
            page.select_option(f"{ed} .pg-rival[data-slug='air-force'] .pg-rival-often", "some")
            # a click on a chip leaves the cursor where it was (no label pulling it into the search box)
            page.click(f"{ed} .pg-rival[data-slug='air-force'] b")
            assert page.evaluate("() => !document.activeElement.classList.contains('pg-rival-search')"), "a chip click pulled the cursor into the search box"
            page.fill(f"{ed} .pg-rival-search", "nevada")
            page.click(f"{ed} .pg-rival-hit[data-slug='nevada']")
            assert page.is_disabled(f"{ed} .pg-rival-search") and "3 of 3" in page.inner_text(f"{ed} .pg-rival-count")
            page.click(f"{ed} .pg-rival[data-slug='nevada'] .pg-rival-x")
            assert not page.is_disabled(f"{ed} .pg-rival-search")
            # a bad roster line is flagged before the game is asked
            page.fill(f"{ed} textarea", page.input_value(f"{ed} textarea") + "\nBad Guy, WRR, SR")
            assert "'WRR' is not a position" in page.inner_text(f"{ed} .pg-problems") and page.is_disabled(f"{ed} button:has-text('Check Program')")
            page.fill(f"{ed} textarea", page.input_value(f"{ed} textarea").replace("\nBad Guy, WRR, SR", ""))
            assert not page.is_disabled(f"{ed} button:has-text('Check Program')")
            page.click(f"{ed} button:has-text('Check Program')")
            page.wait_for_selector(f"{ed} .pg-good", timeout=180_000)
            assert "Ready to use" in page.inner_text(f"{ed} .pg-good")
            # it is kept
            time.sleep(0.6)
            page.reload()
            page.wait_for_selector("#pg-list .pg-card", timeout=30_000)
            assert "Alder Tech" in page.inner_text("#pg-list")
            # download it
            with page.expect_download() as dl:
                page.click("#pg-list .pg-card:has-text('Alder Tech') button:has-text('Download')")
            d = json.loads(Path(dl.value.path()).read_text())
            assert d["format"] == "cfp-league/1" and len(d["teams"]) == 1 and len(d["teams"][0]["roster"]) == 3, d
            assert d["teams"][0]["conference"] == "mountain-west" and d["teams"][0]["roster"][1]["overall"] == 74
            t0 = d["teams"][0]
            assert abs(t0["lat"] - 44.06) < 0.3 and abs(t0["lon"] + 121.31) < 0.3 and t0["state"] == "OR", (t0.get("lat"), t0.get("lon"), t0.get("state"))
            co = d["teams"][0]["coaches"]
            assert co["oc"]["name"] == "Sam Roe" and co["dc"]["name"] == "Lee Poe" and co["offense"] == "Spread RPO" and co["defense"] == "4-3", co
            assert d["teams"][0]["rivals"] == [{"slug": "boise-state", "name": "Battle for the Bell", "rivalry_week": True}, {"slug": "air-force", "every_year": False}], d["teams"][0].get("rivals")
            # edit a real program
            page.wait_for_function("() => document.querySelectorAll('#pg-real option').length > 100", timeout=120_000)
            page.select_option("#pg-real", "akron")
            page.wait_for_selector(f"{ed}:not([hidden])")
            page.fill(f"{ed} .pg-field:has-text('Name') input >> nth=0", "Akron Rubber")
            time.sleep(0.6)
            assert "Edits" in page.inner_text("#pg-list")
            # New Career: tick Alder Tech, the summary and the scheduling note, coach it
            page.goto(f"{base}/index.html")
            page.wait_for_selector("#league-custom .league-custom-row", timeout=120_000)
            page.check("#league-custom .league-custom-row:has-text('Alder Tech') input")
            page.click("#btn-use-programs")
            page.wait_for_selector("#btn-league-start", timeout=300_000)
            note = page.inner_text("#league-result")
            assert "generated fresh" in note, note
            assert page.eval_on_selector("#pick-team", "s => [...s.options].some(o => o.value === 'alder-tech')")
            text = page.inner_text("body")
            for bad in ("null", "undefined", "NaN"):
                assert bad not in text, bad
            page.select_option("#pick-team", "alder-tech")
            page.click("#btn-league-start")
            page.wait_for_selector(".modal:not([hidden]) .start-card button.accent", timeout=30_000)
            page.click(".modal:not([hidden]) .start-card button.accent")
            page.wait_for_selector("#season:not([hidden])", timeout=300_000)
            page.wait_for_function("() => document.querySelector('#chip-name').textContent === 'Alder Tech'", timeout=60_000)
            # a phone: the page fits
            ph = ctx.new_page()
            ph.set_viewport_size({"width": 400, "height": 860})
            ph.goto(f"{base}/programs.html")
            ph.wait_for_selector("#pg-list .pg-card", timeout=60_000)
            assert ph.evaluate("document.documentElement.scrollWidth") <= 400, "sideways scroll on a phone"
            short = ph.eval_on_selector_all(".pg-layout button, .pg-layout select", "els => els.filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().height)).filter(h => h < 44)")
            assert not short, f"controls under 44 px on a phone: {short}"
            assert not errors, errors
            browser.close()
    finally:
        server.terminate()
    print("custom programs page ok: create, check, kept on reload, download, edit a real program; New Career checks it, notes the schedule, and starts a career at it")
