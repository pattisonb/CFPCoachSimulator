"""The old address's banner (GitHub Pages: the game moved to Vercel) can be dismissed, and stays dismissed in that
browser (the player's ask). The page is served under a github.io name the browser resolves to this machine.
Needs Playwright with a Chromium; skipped without one. (Run as a file.)"""
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from test_career_e2e import free_port   # noqa: E402

if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("moved banner test skipped: Playwright is not installed")
        raise SystemExit(0)
    port = free_port()
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/api/teams", timeout=2)
                break
            except OSError:
                time.sleep(0.5)
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(args=["--host-resolver-rules=MAP example.github.io 127.0.0.1"])
            except Exception as exc:  # noqa: BLE001
                print(f"moved banner test skipped: no Chromium ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 400, "height": 800})
            url = f"http://example.github.io:{port}/index.html"
            page.goto(url)
            page.wait_for_selector("#moved-banner:not([hidden])", timeout=30_000)
            box = page.eval_on_selector("#moved-x", "e => e.getBoundingClientRect().height")
            assert box >= 44, f"the dismiss button is 44 px on a phone: {box}"
            page.click("#moved-x")
            assert page.is_hidden("#moved-banner"), "dismissed"
            page.reload()
            time.sleep(0.5)
            assert page.is_hidden("#moved-banner"), "it stays dismissed in this browser"
            fresh = browser.new_context().new_page()
            fresh.goto(url)
            fresh.wait_for_selector("#moved-banner:not([hidden])", timeout=30_000)   # another browser profile still sees it
            # never on the main address
            local = browser.new_page()
            local.goto(f"http://127.0.0.1:{port}/index.html")
            time.sleep(0.5)
            assert local.is_hidden("#moved-banner")
            browser.close()
    finally:
        server.terminate()
    print("moved banner ok: dismissed with its x, it stays dismissed in that browser; another browser still sees it; never on the main address")
