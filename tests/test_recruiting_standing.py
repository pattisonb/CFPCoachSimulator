"""The board's one ladder: `standingOf(b, me)` in web/recruiting.js, read from his list with the
offer as the qualifier, evaluated in a browser on hand-built rows (one per row of the spec's
table in section 5): the list word, the sentence, the odds word and the tone. Needs Playwright
with a Chromium; skipped without one."""
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import free_port, launch   # noqa: E402

ME = "smu"


def row(school, bar, offered, rank):
    return {"school": school, "name": school, "offered": offered, "bar": bar, "rank": rank, "pct": None}


# (b, expected word, text contains, tone), then the odds word where the spec fixes one
CASES = [
    ({"committed": ME, "hard": False, "list": []}, "Yours", "Verbal commit to you", "good", None),
    ({"committed": ME, "hard": True, "list": []}, "Yours", "Hard commit to you", "good", None),
    ({"signed": ME, "committed": ME, "list": []}, "Yours", "Signed with you", "good", None),
    ({"signed": "georgia", "list": []}, "Lost", "Signed · Georgia", "bad", "Locked in"),
    ({"committed": "georgia", "hard": True, "list": []}, "Lost", "Hard commit · Georgia", "bad", "Locked in"),
    ({"committed": "georgia", "list": []}, "Long shot", "Verbal commit · Georgia", "warn", "Offer him to try for a flip"),
    ({"committed": "georgia", "standing": {"pct": 0.35, "lo": 0.2, "hi": 0.5}, "list": []}, "In it", "Verbal commit · Georgia", "warn", "He could still flip to you"),
    ({"committed": "georgia", "standing": {"pct": 0.1, "lo": 0.0, "hi": 0.2}, "list": []}, "Long shot", "Verbal commit · Georgia", "warn", "A flip is a long shot"),
    ({"committed": "georgia", "standing": {"pct": 0.02, "lo": 0.0, "hi": 0.05}, "list": []}, "Long shot", "Verbal commit · Georgia", "warn", "A flip looks unlikely"),
    ({"offered": True, "standing": {"pct": 0.6}, "list": [row(ME, 1.0, True, 1), row("georgia", 0.5, True, 2)]}, "Favourite", "Leading his list", "good", "Clear favorite"),
    ({"offered": True, "standing": {"pct": 0.5}, "list": [row(ME, 1.0, True, 1), row("georgia", 0.9, True, 2)]}, "Favourite", "Leading his list", "good", "Narrow favorite"),
    ({"offered": True, "standing": {"pct": 0.7}, "list": [row(ME, 1.0, True, 1)]}, "Favourite", "Leading his list", "good", "Clear favorite"),
    ({"offered": False, "list": [row(ME, 1.0, False, 1), row("georgia", 0.7, True, 2)]}, "Not offered", "He would pick you today", "warn", "Offer him"),
    ({"offered": True, "standing": {"pct": 0.3}, "list": [row("georgia", 1.0, True, 1), row(ME, 0.95, True, 2)]}, "In it", "2nd on his list · Georgia leads", "warn", "Close race"),
    ({"offered": True, "standing": {"pct": 0.2}, "list": [row("georgia", 1.0, True, 1), row(ME, 0.3, True, 2)]}, "In it", "2nd on his list", "muted", "Behind, in the picture"),
    ({"offered": True, "standing": {"pct": 0.05}, "list": [row("georgia", 1.0, True, 1), row(ME, 0.1, True, 2)]}, "Long shot", "2nd on his list", "muted", "Long shot"),
    ({"offered": False, "list": [row("georgia", 1.0, True, 1), row(ME, 0.4, False, 3)]}, "Not offered", "3rd on his list · not offered", "muted", "Offer to be in it"),
    ({"offered": False, "list": [row("georgia", 1.0, True, 1)]}, "Not offered", "Not on his list yet", "muted", None),
]
WORDS = {"Yours", "Lost", "Favourite", "In it", "Long shot", "Not offered"}
TONES = {"good", "warn", "muted", "bad"}


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("recruiting standing skipped: Playwright is not installed")
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
                print(f"recruiting standing skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page()
            page.goto(f"{base}/index.html")
            page.wait_for_function("() => window.CFP && window.CFP.teamsBySlug && window.CFP.teamsBySlug.georgia", timeout=60_000)
            assert page.evaluate("() => !!(window.CFP.recruiting && window.CFP.recruiting.standingOf)"), "window.CFP.recruiting.standingOf is missing"
            for b, word, text, tone, odds in CASES:
                sd = page.evaluate("([b, me]) => window.CFP.recruiting.standingOf(b, me)", [b, ME])
                assert sd["word"] == word, f"{b}: word {sd['word']!r}, expected {word!r}"
                assert text in sd["text"], f"{b}: text {sd['text']!r} should contain {text!r}"
                assert sd["tone"] == tone, f"{b}: tone {sd['tone']!r}, expected {tone!r}"
                if odds is not None:
                    assert sd.get("odds") == odds, f"{b}: odds {sd.get('odds')!r}, expected {odds!r}"
                assert sd["word"] in WORDS and sd["tone"] in TONES, sd
                assert 0 <= (sd.get("fill") or 0) <= 1, sd
            # the words never come from the offer race: offered but outside the five schools his list shows
            # (the board sends his top five), the word is a long shot, never "Not offered" and never the race's place
            sd = page.evaluate("([b, me]) => window.CFP.recruiting.standingOf(b, me)",
                               [{"offered": True, "standing": {"pct": 0.9, "place": 1, "of": 1, "leader": {"name": "SMU"}}, "list": [row("georgia", 1.0, True, 1)]}, ME])
            assert sd["word"] == "Long shot" and sd["text"] == "Outside his top 5" and sd["tone"] == "muted", sd
            browser.close()
        print("ok")
    finally:
        server.terminate()
        server.wait(timeout=30)
