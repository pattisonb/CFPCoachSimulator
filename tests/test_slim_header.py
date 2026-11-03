"""The slim header (round 3, slim-header brief): with a career open the black top bar is hidden and the tab bar is the
first thing on the page; ☰ Menu at the tab bar's right end (first on a phone) is a dropdown: Settings, Download Career
and Show/Hide the Top Bar (in place; the choice survives a reload); no season open, the bar shows. No season banner remains: the tab bar's team
chip shows the school, the rank when ranked, the record and the week, and follows a simmed week. Settings opens and
Download Career downloads from the menu on any tab, Settings waits while a sim runs. At 400 px: ☰ Menu, then the chip, then the tabs; no sideways scroll; the controls are 44 px. The depth chart
screen and the offseason still open. Needs Playwright with a Chromium; skipped without one. (Run as a file.)"""
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch, menu_pick   # noqa: E402

SHOWN = "() => getComputedStyle(document.querySelector('.topbar')).display !== 'none'"


def open_career(page, base, sid, tab="office", wait=".go-play [data-play=advance]"):
    page.goto(f"{base}/index.html?id={sid}&tab={tab}")
    page.wait_for_selector("#season:visible")
    page.wait_for_selector(wait, timeout=120_000)
    time.sleep(0.5)


def check_top_bar(page, base, sid) -> None:
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(f"{base}/index.html")
    page.wait_for_selector("#btn-new:visible")
    page.evaluate("() => localStorage.removeItem('cfp.topbar')")
    assert page.evaluate(SHOWN), "no season open: the top bar shows"
    open_career(page, base, sid)
    assert not page.evaluate(SHOWN), "a career open: the top bar is hidden by default"
    first = page.evaluate("""() => { const t = document.querySelector('#season-tabs').getBoundingClientRect();
        const above = [...document.body.querySelectorAll('*')].filter(e => e.offsetParent !== null && !e.closest('#season-tabs') && !e.contains(document.querySelector('#season-tabs'))
          && getComputedStyle(e).position !== 'fixed' && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().bottom <= t.top + 0.5);
        return { top: t.top, above: above.map(e => e.tagName + '.' + e.className).slice(0, 4) }; }""")
    assert first["top"] < 24 and not first["above"], f"the tab bar is the first thing on the page: {first}"
    assert page.get_attribute("#btn-menu", "data-topbar") == "hidden" and page.get_attribute("#btn-menu", "aria-haspopup") == "menu"
    assert page.inner_text("#btn-menu").strip() == "☰ Menu"
    # ☰ Menu is a dropdown: Settings, Download Career, the top bar
    page.click("#btn-menu")
    items = page.eval_on_selector_all(".go-menu .go-menu-item b", "els => els.map(e => e.textContent)")
    assert items == ["⚙ Settings", "Download Career", "Show the Top Bar"], items
    page.keyboard.press("Escape")
    # Show the Top Bar puts it above the tabs, in place: the Office is not redrawn
    page.evaluate("() => { window.__office = document.querySelector('#tab-office').firstElementChild; }")
    menu_pick(page, "Show the Top Bar")
    assert page.evaluate(SHOWN), "☰ Menu shows the top bar"
    assert page.get_attribute("#btn-menu", "data-topbar") == "shown"
    r = page.evaluate("() => ({ bar: document.querySelector('.topbar').getBoundingClientRect().bottom, tabs: document.querySelector('#season-tabs').getBoundingClientRect().top })")
    assert r["bar"] > 40 and r["bar"] <= r["tabs"] + 0.5, f"the bar sits above the tabs: {r}"
    assert page.is_visible("#btn-seasons-menu") and page.is_visible(".topbar .btn-theme") and page.is_visible(".site-nav a[href='./coach.html']")
    assert page.evaluate("() => window.__office === document.querySelector('#tab-office').firstElementChild && window.__office.isConnected"), "showing the bar redrew the Office"
    # the choice survives a reload
    open_career(page, base, sid)
    assert page.evaluate(SHOWN), "the shown bar survives a reload"
    menu_pick(page, "Hide the Top Bar")
    assert not page.evaluate(SHOWN), "☰ Menu hides it again"
    open_career(page, base, sid)
    assert not page.evaluate(SHOWN), "the hidden bar survives a reload"
    # scrolling neither hides nor shows it any more
    page.evaluate("() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 900); }")
    time.sleep(0.3)
    page.evaluate("() => window.scrollTo(0, 700)")
    page.mouse.move(600, 2)
    time.sleep(0.3)
    assert not page.evaluate(SHOWN), "scrolling or the pointer at the top edge does not bring the bar back"
    page.evaluate("() => { document.body.style.minHeight = ''; window.scrollTo(0, 0); }")


def check_no_banner_and_chip(page, base, sid) -> None:
    page.set_viewport_size({"width": 1280, "height": 900})
    s = call(base, f"/api/season/{sid}")
    open_career(page, base, sid)
    assert not page.query_selector(".season-head, .season-head-row, #season-title, #season-meta, #season-compact, #btn-compact-more"), "no season banner remains"
    name = page.inner_text("#chip-name")
    line = page.inner_text("#chip-line")
    assert name == s["team_name"], name
    rank = (s.get("my_rank") or {}).get("rank")
    want = " · ".join(x for x in [f"#{rank}" if rank else "", f"{s['record']['wins']}-{s['record']['losses']}", f"Week {s['current_week'] + 1}"] if x)
    assert line == want, (line, want)
    for bad in ("null", "undefined", "NaN"):
        assert bad not in name + line + (page.get_attribute("#team-chip", "title") or ""), (name, line)
    # the chip sits at the left end of the tab bar, ☰ Menu at the right end
    r = page.evaluate("""() => { const q = (x) => document.querySelector(x).getBoundingClientRect();
        return { chip: q('#team-chip'), row: q('#season-tabs .tab-row'), menu: q('#btn-menu'), bar: q('#season-tabs') }; }""")
    assert r["chip"]["right"] <= r["row"]["left"] + 0.5 and r["row"]["right"] <= r["menu"]["left"] + 0.5, r
    assert r["bar"]["height"] <= 52, f"the tab bar is slimmer: {r['bar']['height']}"
    assert page.evaluate("() => Math.min(...[...document.querySelectorAll('#season-tabs button:not([hidden])')].map(b => b.getBoundingClientRect().height).filter(h => h > 0))") >= 36
    # Settings and Download Career live behind ☰ Menu, on every tab; no buttons on the page
    assert not page.is_visible("#btn-settings") and not page.is_visible("#btn-download-career"), "no Office buttons: ☰ Menu"
    page.click("#season-tabs button[data-tab=standings]")
    menu_pick(page, "Settings")
    page.wait_for_selector("#modal:not([hidden]) .settings", timeout=30_000)
    page.keyboard.press("Escape")
    page.wait_for_selector("#modal", state="hidden", timeout=10_000)
    with page.expect_download(timeout=60_000) as dl:
        menu_pick(page, "Download Career")
    assert dl.value.suggested_filename.endswith(".ccsave"), dl.value.suggested_filename
    page.click("#season-tabs button[data-tab=office]")
    # a simmed week: Settings is disabled while it runs, then the chip follows
    page.wait_for_selector(".go-play [data-play=advance]:not([disabled])", timeout=60_000)
    page.click("#tab-office .go-play [data-play=advance]")
    page.wait_for_function("() => document.body.classList.contains('simming')", timeout=10_000)
    # mid-sim the tab bar, ☰ Menu with it, takes no clicks: Settings waits for the sim
    assert page.evaluate("() => !document.body.classList.contains('simming') || getComputedStyle(document.querySelector('#btn-menu')).pointerEvents === 'none'")
    for _ in range(600):
        if call(base, f"/api/season/{sid}/status?since=0")["status"] != "running" and call(base, f"/api/season/{sid}")["current_week"] >= 1:
            break
        time.sleep(0.5)
    page.wait_for_function("() => !document.body.classList.contains('simming')", timeout=60_000)
    s = call(base, f"/api/season/{sid}")
    rec = f"{s['record']['wins']}-{s['record']['losses']}"
    page.wait_for_function("(want) => document.querySelector('#chip-line').textContent.includes(want)", arg=f"{rec} · Week {s['current_week'] + 1}", timeout=30_000)


def check_phone(page, base, sid) -> None:
    page.set_viewport_size({"width": 400, "height": 860})
    for tab, wait in (("office", ".go-play [data-play=advance]"), ("schedule", ".schedule-pick"), ("recruiting", "#tab-recruiting .go-card")):
        open_career(page, base, sid, tab, wait)
        assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), f"no sideways scroll on {tab}"
        r = page.evaluate("""() => { const q = (x) => document.querySelector(x).getBoundingClientRect();
            return { menu: q('#btn-menu'), chip: q('#team-chip'), row: q('#season-tabs .tab-row'), bar: q('#season-tabs'),
                     tabs: Math.min(...[...document.querySelectorAll('#season-tabs .tab-row button:not([hidden])')].map(b => b.getBoundingClientRect().height).filter(h => h > 0)) }; }""")
        assert r["menu"]["right"] <= r["chip"]["left"] + 0.5 and r["chip"]["right"] <= r["row"]["left"] + 0.5, f"☰ Menu, the chip, then the tabs: {r}"
        assert r["menu"]["height"] >= 44 and r["tabs"] >= 44, f"44 px controls: {r}"
        assert r["bar"]["right"] <= 400.5, r
        assert page.evaluate("() => { const t = document.querySelector('#season-tabs .tab-row'); return t.scrollWidth > t.clientWidth; }"), "the tabs scroll sideways"
    menu_pick(page, "Show the Top Bar")
    assert page.evaluate(SHOWN)
    assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways scroll with the bar shown"
    menu_pick(page, "Hide the Top Bar")
    page.set_viewport_size({"width": 1280, "height": 900})


def check_other_screens(page, base, sid, done) -> None:
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(f"{base}/index.html?id={sid}&screen=depth")
    page.wait_for_selector(".dc-card", timeout=120_000)
    assert not page.evaluate(SHOWN)
    h = page.evaluate("() => [document.querySelector('#depth-screen').getBoundingClientRect().height, innerHeight]")
    assert abs(h[0] - h[1]) <= 2, f"the depth chart fills the window: {h}"
    page.goto(f"{base}/index.html?id={done}")
    page.wait_for_selector("#tab-offseason .off-steps", timeout=120_000)
    page.click("#btn-menu")
    items = page.eval_on_selector_all(".go-menu .go-menu-item b", "els => els.map(e => e.textContent)")
    assert "⚙ Settings" in items and "Download Career" in items, items
    page.keyboard.press("Escape")
    assert "Offseason" in page.inner_text("#chip-line")


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("slim header test skipped: Playwright is not installed")
        raise SystemExit(0)
    from sim import season
    from test_offseason import finished
    fresh = season.new_season("ohio-state", "full", seed=31, career=True)
    season.save_season(fresh)
    done = season.new_season("smu", "full", seed=32, career=True)
    finished(done)
    season.save_season(done)
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
                print(f"slim header test skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 900}, accept_downloads=True)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.dismiss())
            check_top_bar(page, base, fresh["id"])
            check_phone(page, base, fresh["id"])
            check_other_screens(page, base, fresh["id"], done["id"])
            check_no_banner_and_chip(page, base, fresh["id"])
            browser.close()
        assert not errors, errors
        print("slim header ok: the top bar waits behind ☰ Menu, the tab bar leads with the team chip, Settings and Download Career behind ☰ Menu")
    finally:
        for sid in (fresh["id"], done["id"]):
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
        server.terminate()
