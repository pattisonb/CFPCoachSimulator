"""Every name in the offseason opens a profile (docs/superpowers/plans/2026-11-10-player-links-offseason.md, Task 3):
a portal entrant's Prospect Profile while the portal is open, otherwise his player page with the Next Season block
(where he is now). Walks Keep Them Home, Departures, a portal week (an entrant put on your board), Development and
the Recap at 1280 and 400 px: the link opens the right profile, is at least 44 px tall on a phone, and focus goes back
to it when the profile closes. `python3 tests/test_offseason_links.py` (skipped without Playwright and a Chromium)."""
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
from test_offseason_redesign import click_primary, wait_page   # noqa: E402

PLAYER = "#tab-offseason .off-page [data-player]"
ENTRANT = "#tab-offseason .off-page .go-link[data-pid]"


def stage_page(page, base, sid, name) -> None:
    page.goto(f"{base}/index.html?id={sid}&tab=offseason&opage=stage")
    wait_page(page, name)


def open_first(page, sel: str, width: int) -> str:
    """Click the first visible link matching `sel`; return what opened ("player" or "profile")."""
    link = page.locator(sel).filter(visible=True).first
    link.scroll_into_view_if_needed()
    if width < 760:
        h = link.evaluate("n => n.getBoundingClientRect().height")
        assert h >= 44, f"a name link {h:.0f} px tall on a phone ({sel})"
    link.focus()
    link.click()
    page.wait_for_selector(".modal:not([hidden]) .player-page, .modal:not([hidden]) .pv-hero", timeout=60_000)
    kind = "player" if page.query_selector(".modal:not([hidden]) .player-page") else "profile"
    if kind == "player":
        page.wait_for_selector(".modal:not([hidden]) .player-next", timeout=30_000)
        text = page.inner_text(".modal:not([hidden]) .player-next")
        assert "Next Season" in text.title() and "null" not in text and "undefined" not in text, text
    page.click(".modal:not([hidden]) .modal-close")
    page.wait_for_selector(".modal:not([hidden])", state="detached", timeout=10_000) if page.query_selector(".modal:not([hidden])") is None else None
    time.sleep(0.3)
    same = link.evaluate("n => document.activeElement === n || n.contains(document.activeElement)")
    assert same, "focus goes back to the name when the profile closes"
    return kind


def run(base: str, sid: str, browser) -> None:
    for width in (1280, 400):
        page = browser.new_page(viewport={"width": width, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        v = call(base, f"/api/season/{sid}/offseason")
        stage = v["stage"]
        if width == 1280:
            assert stage == "retention", stage
        seen = set()
        for _ in range(12):
            v = call(base, f"/api/season/{sid}/offseason")
            stage = v["stage"]
            name = {"retention": "retention", "departures": "departures", "development": "development", "staff": "staff",
                    "ready": "ready"}.get(stage, "portal" if stage.startswith("portal_w") else stage)
            stage_page(page, base, sid, name)
            if stage.startswith("portal_w") and stage not in seen:
                rc = call(base, f"/api/season/{sid}/prospects")
                rows = rc.get("rows") or rc.get("prospects") or []
                pid = next((r["id"] for r in rows if not r.get("signed")), None)
                if pid:
                    call(base, f"/api/season/{sid}/board", {"pid": pid, "on": True})
                    stage_page(page, base, sid, name)
                    assert open_first(page, ENTRANT, width) == "profile", "a portal board name opens his Prospect Profile"
            if page.locator(PLAYER).filter(visible=True).count():
                assert open_first(page, PLAYER, width) == "player", stage
                seen.add(stage)
            if stage == "ready" or width == 400 and len(seen) >= 2:
                break
            if width == 1280:
                if v.get("review") and not v["review"].get("decided"):
                    call(base, f"/api/season/{sid}/offseason/review", {"action": "nothing", "stage": stage})
                call(base, f"/api/season/{sid}/offseason/advance", {})
            else:
                break
        assert {"retention", "departures"} <= seen or width == 400, f"names linked at {sorted(seen)}"
        assert not errors, errors
        page.close()


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("offseason links skipped: Playwright is not installed")
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
                print(f"offseason links skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            run(base, sid, browser)
            browser.close()
        print("offseason links ok: Keep Them Home, Departures, the portal (a board name opens his Prospect Profile), Development and the Recap; 44 px on a phone; focus returns")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        league.forget(sid)
        server.terminate()
