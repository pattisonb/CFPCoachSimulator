"""Custom Programs on the page: create a program (name, colors, conference, three players), check it, reload and it is
still there, download it as a league file, edit a real program; then on New Career tick it, see the summary with the
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
            page.fill(f"{ed} .pg-field:has-text('Name') input >> nth=0", "Alder Tech")
            page.fill(f"{ed} .pg-field:has-text('Mascot') input", "Owls")
            page.fill(f"{ed} .pg-field:has-text('City') input", "Bend")
            page.select_option(f"{ed} .pg-field:has-text('State') select", "OR")
            page.select_option(f"{ed} .pg-field:has-text('Conference') select >> nth=0", "mountain-west")
            page.fill(f"{ed} textarea", "Jay Smith, QB, JR\nMax Lee, WR, SO, 74\nAl Cruz, LT, SR")
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
    print("custom programs page ok: create, check, kept on reload, download, edit a real program; New Career ticks it, notes the schedule, and starts a career at it")
