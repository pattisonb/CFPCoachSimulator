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


def next_text(page) -> str:
    page.wait_for_selector(".modal:not([hidden]) .player-next", timeout=30_000)
    text = page.inner_text(".modal:not([hidden]) .player-next")
    assert "NEXT SEASON" in text.upper() and "null" not in text and "undefined" not in text and "NaN" not in text, text
    return text


def close_modal(page) -> None:
    page.click(".modal:not([hidden]) .modal-close")
    page.wait_for_function("() => !document.querySelector('.modal:not([hidden])')", timeout=10_000)
    time.sleep(0.2)


def open_link(page, link, width: int) -> tuple[str, str]:
    """Click a name link; return what opened ("player" with its Next Season text, or "profile")."""
    link.scroll_into_view_if_needed()
    if width < 760:
        h = link.evaluate("n => n.getBoundingClientRect().height")
        assert 44 <= h < 80, f"a name link {h:.0f} px tall on a phone"
    link.focus()
    link.click()
    page.wait_for_selector(".modal:not([hidden]) .player-page, .modal:not([hidden]) .pv-hero", timeout=60_000)
    kind = "player" if page.query_selector(".modal:not([hidden]) .player-page") else "profile"
    text = next_text(page) if kind == "player" else ""
    close_modal(page)
    assert link.evaluate("n => document.activeElement === n"), "focus goes back to the name when the profile closes"
    return kind, text


def first(page, sel: str):
    loc = page.locator(sel).filter(visible=True)
    assert loc.count(), f"no visible link: {sel}"
    return loc.first


def both_widths(page, check) -> None:
    for width in (1280, 400):
        page.set_viewport_size({"width": width, "height": 900})
        time.sleep(0.3)
        check(width)
    page.set_viewport_size({"width": 1280, "height": 900})


def decide_review(base, sid) -> None:
    v = call(base, f"/api/season/{sid}/offseason")
    if v.get("review") and not v["review"].get("decided"):
        call(base, f"/api/season/{sid}/offseason/review", {"action": "nothing", "stage": v["stage"]})


def run(base: str, sid: str, browser) -> None:
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    assert call(base, f"/api/season/{sid}/offseason")["stage"] == "retention"
    decide_review(base, sid)

    # Keep Them Home: a leaver's card opens his page; then advance in the page (no reload) and open him again from
    # Departures: the Next Season block is fresh, not the cached Keep Them Home one
    stage_page(page, base, sid, "retention")
    both_widths(page, lambda w: open_link(page, first(page, ".off-keep [data-player]"), w))
    link = first(page, ".off-keep [data-player]")
    slug = link.get_attribute("data-player").split("|")[3]
    _, before = open_link(page, link, 1280)
    click_primary(page)
    wait_page(page, "departures")
    again = page.locator(f"#tab-offseason [data-player$='|{slug}']").filter(visible=True)
    assert again.count(), "the Keep Them Home leaver shows at Departures"
    _, after = open_link(page, again.first, 1280)
    assert after != before, f"the Next Season block is fresh after advancing: {before!r} then {after!r}"

    # Departures: the leavers' table, a graduate's departed line, The First Round, and the redshirt toggles' names
    def departures(width):
        open_link(page, first(page, ".off-dep-table [data-player]"), width)
        grad = page.locator("details.off-group").filter(has_text="Graduated").locator("[data-player]").filter(visible=True)
        if grad.count():
            _, text = open_link(page, grad.first, width)
            assert "Graduated" in text, text
        open_link(page, first(page, ".off-draft [data-player]"), width)
        toggles = page.locator(".off-rs button.go-act").count()
        names = page.locator(".off-rs [data-player]").count()
        assert names == toggles, f"every redshirt toggle's player links ({names} of {toggles})"
        if toggles:
            open_link(page, first(page, ".off-rs [data-player]"), width)
    stage_page(page, base, sid, "departures")
    both_widths(page, departures)

    # the portal: an entrant on your board opens his Prospect Profile
    decide_review(base, sid)
    call(base, f"/api/season/{sid}/offseason/advance", {})
    assert call(base, f"/api/season/{sid}/offseason")["stage"].startswith("portal_w")
    rows = call(base, f"/api/season/{sid}/prospects").get("rows") or []
    pid = next((r["id"] for r in rows if not r.get("signed")), None)
    assert pid, "an unsigned entrant to put on the board"
    call(base, f"/api/season/{sid}/board", {"pid": pid, "on": True})
    stage_page(page, base, sid, "portal")
    def portal(width):
        kind, _ = open_link(page, first(page, ENTRANT), width)
        assert kind == "profile", "a portal board name opens his Prospect Profile"
    both_widths(page, portal)

    # after the portal: no Prospect Profile buttons are left; Development's names open player pages
    for _ in range(8):
        if call(base, f"/api/season/{sid}/offseason")["stage"] == "development":
            break
        decide_review(base, sid)
        call(base, f"/api/season/{sid}/offseason/advance", {})
    stage_page(page, base, sid, "development")
    assert not page.locator("#tab-offseason .go-link[data-pid]").count(), "no Prospect Profile link after the portal closes"
    both_widths(page, lambda w: open_link(page, first(page, PLAYER), w))
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
        print("offseason links ok: Keep Them Home, Departures (a graduate, the first round, redshirt toggles), the portal (a board name opens his Prospect Profile), Development (no entrant links left); fresh after an in-page advance; 1280 and 400 (44 px); focus returns")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        league.forget(sid)
        server.terminate()
