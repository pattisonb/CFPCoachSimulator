"""The browser tab names the dynasty ("Georgia Dynasty") and, while a sim runs, leads with the progress and
your record ("42% · 3-0 · Wk 4 · Georgia Dynasty") with a progress ring drawn on the favicon; when the sim
ends the tab says "Done · 4-0 · …" for a moment, then the dynasty's name and its own favicon are back."""
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from test_career_e2e import call, free_port, launch   # noqa: E402

if __name__ == "__main__":
    from playwright.sync_api import sync_playwright
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
        sid = call(base, "/api/season", {"team": "georgia", "mode": "full", "career": True, "seed": 31})["id"]
        call(base, f"/api/season/{sid}/settings", {"auto_recruit": True})
        with sync_playwright() as p:
            browser = launch(p)
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/index.html?id={sid}")
            page.wait_for_selector(".go-play")
            assert page.title() == "Georgia Dynasty", page.title()
            icon = lambda: page.evaluate("() => document.querySelector(\"link[rel='icon']\").getAttribute('href')")   # noqa: E731
            assert icon() == "./favicon.svg", icon()
            page.click(".go-play >> text=/Sim the Week|ADVANCE THE WEEK/")
            page.wait_for_function("() => /^\\d+% · \\d+-\\d+ · Wk \\d+ · Georgia Dynasty$/.test(document.title)", timeout=60_000)
            simming = page.title()
            assert icon().startswith("data:image/png"), icon()[:40]
            page.wait_for_function("() => /^Done · \\d+-\\d+ · Georgia Dynasty$/.test(document.title)", timeout=120_000)
            done = page.title()
            assert icon().startswith("data:image/png"), icon()[:40]
            page.wait_for_function("() => document.title === 'Georgia Dynasty'", timeout=15_000)
            assert icon() == "./favicon.svg", icon()
            record = re.search(r"\d+-\d+", done).group()
            assert record in page.text_content("#chip-line"), (done, page.text_content("#chip-line"))   # the record it announced is the page's
            assert not errors, errors
            browser.close()
        print(f"tab status ok: {simming!r} while simming, {done!r} at the end, then the dynasty's name and its own favicon")
    finally:
        server.terminate()
