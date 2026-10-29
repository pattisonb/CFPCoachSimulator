"""Coach Career's offseason in a browser: a finished season (faked as in test_offseason.py) opens
on the Offseason screen; you walk departures, make a portal offer, close both rounds, see who
improved, hire a coach when one leaves, and start the next season, which opens on the Office of
2027. Needs Playwright with a Chromium; without one it is skipped with the reason. (Run as a
file: multiprocessing on Windows.)"""
import os
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
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("offseason e2e skipped: Playwright is not installed")
        raise SystemExit(0)
    from coach_career import league
    from sim import season
    from test_offseason import finished
    st = season.new_season("georgia", "full", seed=8, career=True)
    finished(st)
    season.save_season(st)
    sid = st["id"]
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "server.py", "--local"], cwd=ROOT, env={**os.environ, "PORT": str(port), "CFP_MAX_CAREERS": "0"},
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
                print(f"offseason e2e skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/season?id={sid}")
            page.wait_for_selector("#tab-offseason .off-steps", timeout=120_000)   # a finished career opens on the offseason
            assert page.is_visible("#season-tabs button[data-tab=offseason]")
            assert "DEPARTURES" in page.inner_text("#tab-offseason")
            assert "LEAVING YOUR PROGRAM" in page.inner_text("#tab-offseason")
            if "KEEP THEM HOME" in page.inner_text("#tab-offseason .go-btn.primary.big"):   # your leavers with eligibility left wait on you
                page.click("#tab-offseason .go-btn.primary.big")                           # (the stages strip says it too: click the button)
                page.wait_for_selector("text=WANT OUT", timeout=60_000)
                first = page.query_selector("button.go-act:has-text('Meet')")
                if first:
                    first.click(); page.wait_for_selector("text=He wants", timeout=30_000)
            page.click("text=OPEN THE TRANSFER PORTAL")
            page.wait_for_selector("text=WEEK 1 OF 4", timeout=120_000)
            assert not page.query_selector(".off-board .go-pcard"), "the portal opens with an empty board"
            # you pick an entrant from the pool (the best one not leaving your own program) and recruit him on the board
            pool = call(base, f"/api/season/{sid}/prospects?limit=20")["rows"]
            pick = next(r for r in pool if r.get("from") != "georgia" and not r.get("committed"))
            call(base, f"/api/season/{sid}/board", {"pid": pick["id"], "on": True})
            page.reload(); page.wait_for_selector("#season:visible")
            page.wait_for_selector(".off-board .go-pcard", timeout=60_000)          # the portal is recruited on the board
            assert "WEEK 1 OF 4" in page.inner_text("#tab-offseason")
            page.click(".off-board .go-pcard .go-pcard-top >> nth=0")                # he opens in the pane beside the columns
            page.click(".off-board .go-pane button.go-btn.primary:has-text('Offer')")   # an offer, with the pitch and the NIL his ask suggests
            page.wait_for_selector(".off-board .go-pcard >> nth=0 >> text=Offered", timeout=30_000)
            for w in (1, 2, 3):
                page.click(f"text=END WEEK {w}")
                page.wait_for_selector(f"text=WEEK {w + 1} OF 4", timeout=120_000)
            page.click("text=CLOSE THE PORTAL")
            page.wait_for_selector("text=WHO IMPROVED", timeout=120_000)
            page.click("text=STAFF CHANGES")
            page.wait_for_selector("text=YOUR STAFF", timeout=60_000)
            if page.query_selector(".off-cand"):
                page.click(".off-cand >> nth=1")
                page.wait_for_selector(".off-cand.picked", timeout=30_000)
            page.screenshot(path=os.environ.get("SHOT_DIR", str(ROOT / "data" / "seasons")) + f"/{sid}-offseason.png", full_page=True)
            page.click("text=FINISH THE OFFSEASON")
            page.wait_for_selector("text=START THE 2027 SEASON", timeout=60_000)
            page.click("text=START THE 2027 SEASON")
            page.wait_for_selector(".go-office", timeout=300_000)                 # the next season opens on the Office
            page.wait_for_selector("#tab-office >> text=CLASS OF 2028", timeout=120_000)   # the new class of seniors
            summary = call(base, f"/api/season/{sid}")
            assert summary["year"] == 2027 and summary["current_week"] == 0 and not summary["done"]
            assert not page.is_visible("#season-tabs button[data-tab=offseason]")
            assert not errors, errors
            browser.close()
        print("offseason e2e ok: departures, a portal offer on the board, four weeks, development, staff, on to 2027")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001 - already gone
            pass
        shot = ROOT / "data" / "seasons" / f"{sid}-offseason.png"
        if shot.exists():
            shot.unlink()
        league.forget(sid)
        server.terminate()
        server.wait(timeout=30)
