"""The Programs tab shows the Pro Pipeline: a bar in Your Program with one of the eight grade words, the draft-position
chips under the bars (best first, "WR Elite"), a Pro Pipeline column in Every Program, and the chips wrap on a phone
with no sideways scroll. Needs Playwright with a Chromium; skipped without one. (Run as a file.)"""
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

from test_career_e2e import free_port, launch, tab_click   # noqa: E402

WORDS = ("Elite", "Excellent", "Strong", "Good", "Solid", "Fair", "Thin", "Weak")
CHIP = re.compile(r"^[A-Z]+ (Elite|Excellent|Strong|Good|Solid|Fair|Thin|Weak)$")


def check(page, base, sid, width):
    page.goto(f"{base}/index.html?id={sid}&tab=office")
    page.wait_for_selector("#season:visible")
    tab_click(page, "programs")
    page.wait_for_selector("#tab-programs .go-programs tbody tr", timeout=120_000)
    time.sleep(0.5)
    labels = page.eval_on_selector_all("#tab-programs .go-program-bar", "els => els.map(e => [e.querySelector('.go-program-label').textContent, e.querySelector('.go-program-val').textContent])")
    pro = [w for l, w in labels if l == "Pro Pipeline"]
    assert pro and pro[0] in WORDS, labels
    chips = page.eval_on_selector_all("#tab-programs .go-program-groups .go-tag", "els => els.map(e => e.textContent)")
    assert len(chips) >= 8 and CHIP.match(chips[0]), chips
    assert all(CHIP.match(c) for c in chips), chips
    heads = page.eval_on_selector_all("#tab-programs .go-programs thead th", "els => els.map(e => e.textContent)")
    assert "Pro Pipeline" in heads, heads
    words = page.eval_on_selector_all("#tab-programs .go-programs td.word", "els => els.map(e => e.textContent)")
    assert words and all(w in WORDS for w in words), set(words) - set(WORDS)
    text = page.inner_text("#tab-programs")
    for bad in ("null", "undefined", "NaN"):
        assert bad not in text, bad
    if width <= 400:
        assert page.evaluate("document.documentElement.scrollWidth") <= width, "sideways scroll"
    return chips


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("pro page test skipped: Playwright is not installed")
        raise SystemExit(0)
    from sim import season
    st = season.new_season("ohio-state", "full", seed=31, career=True)
    season.save_season(st)
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
                print(f"pro page test skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            shots = os.environ.get("PRO_SHOTS")
            for width, height in ((1280, 900), (400, 800)):
                page = browser.new_page(viewport={"width": width, "height": height})
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                chips = check(page, base, st["id"], width)
                if shots:
                    Path(shots).mkdir(parents=True, exist_ok=True)
                    page.screenshot(path=f"{shots}/programs-{width}.png", full_page=True)
                assert not errors, errors
                page.close()
            browser.close()
        print(f"pro page ok: Programs tab at 1280 and 400, {len(chips)} chips, first {chips[0]}")
    finally:
        server.terminate()
