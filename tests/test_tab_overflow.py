"""The season tab bar never scrolls sideways: the tabs that do not fit go behind a More ▾ button (priority+ pattern,
web/season.js layoutTabs). Checked in the offseason (every tab on) at 1280, 1024, 768 and 400 px: the row does not
scroll, every shown tab and More sit inside the row, More's menu lists exactly the overflowed tabs, picking one opens it
and it shows in the row, the open tab is never behind More, a switch starts no pulse or fade, and More and the tabs are
44 px tall on a phone. Needs Playwright with a Chromium; skipped without one. (Run as a file.)"""
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
from test_smoothness import QUIET_WATCH   # noqa: E402

STATE = """() => {
  const row = document.querySelector('#season-tabs .tab-row'), r = row.getBoundingClientRect();
  const eligible = [...row.querySelectorAll('button[data-tab]')].filter(b => !b.hidden && (getComputedStyle(b).display !== 'none' || b.classList.contains('tab-ovf')));
  const shown = eligible.filter(b => !b.classList.contains('tab-ovf'));
  const more = document.querySelector('#tab-more'), mr = more.getBoundingClientRect();
  const inside = (e) => { const x = e.getBoundingClientRect(); return x.left >= r.left - 0.5 && x.right <= r.right + 0.5; };
  const act = row.querySelector('button.active[data-tab]');
  return { scroll: [row.scrollWidth, row.clientWidth], overflowed: eligible.filter(b => b.classList.contains('tab-ovf')).map(b => b.dataset.tab),
           shown: shown.map(b => b.dataset.tab), outside: shown.filter(b => !inside(b)).map(b => b.dataset.tab),
           moreShown: !more.hidden && mr.width > 0, moreInside: !more.hidden && inside(more), moreH: mr.height, moreText: more.textContent.trim(),
           moreAria: [more.getAttribute('aria-haspopup'), more.getAttribute('aria-expanded'), more.getAttribute('aria-label')],
           tabH: Math.min(...shown.map(b => b.getBoundingClientRect().height)), active: act ? act.dataset.tab : null,
           activeVisible: !!row.querySelector('button.active[data-tab]:not(.tab-ovf)'), page: document.documentElement.scrollWidth <= innerWidth + 1,
           bar: document.querySelector('#season-tabs').getBoundingClientRect().right <= innerWidth + 0.5 }; }"""


def check_width(page, width, phone=False) -> None:
    s = page.evaluate(STATE)
    assert s["scroll"][0] <= s["scroll"][1] + 1, f"{width}: the tab row scrolls sideways {s['scroll']}"
    assert not s["outside"], f"{width}: tabs outside the row {s['outside']}"
    assert s["page"] and s["bar"], f"{width}: the page scrolls sideways"
    assert s["activeVisible"], f"{width}: the open tab {s['active']} is not in the row"
    if s["overflowed"]:
        assert s["moreShown"] and s["moreInside"], f"{width}: More is missing or outside the row {s}"
        assert s["moreAria"][0] == "menu" and s["moreAria"][1] == "false" and s["moreAria"][2] == "More", s["moreAria"]
        assert s["moreText"] == "More ▾", s["moreText"]
        if phone:
            assert s["tabH"] >= 43.5 and s["moreH"] >= 43.5, f"{width}: 44 px controls {s['tabH']} {s['moreH']}"
        page.click("#tab-more")
        assert page.get_attribute("#tab-more", "aria-expanded") == "true"
        names = page.eval_on_selector_all(".go-menu .go-menu-item b", "els => els.map(e => e.textContent)")
        want = page.evaluate("(ids) => ids.map(t => document.querySelector(`#season-tabs button[data-tab=${t}]`).textContent.trim())", s["overflowed"])
        assert names == want, f"{width}: More lists {names}, the hidden tabs are {want}"
        pick = next(t for t in s["overflowed"] if t != "depth")   # the depth chart is its own screen, not a tab body
        page.evaluate(QUIET_WATCH)
        page.click(f".go-menu .go-menu-item:has(b:text-is('{want[s['overflowed'].index(pick)]}'))")
        page.wait_for_function("(t) => document.querySelector(`#season-tabs button[data-tab=${t}]`).classList.contains('active')", arg=pick, timeout=60_000)
        time.sleep(0.5)
        loud = page.evaluate("() => { window.__quiet.obs.disconnect(); return window.__quiet.what; }")
        assert not [c for c in loud if "tab" in c], f"{width}: the tab bar pulsed {loud}"
        s2 = page.evaluate(STATE)
        assert s2["active"] == pick and pick in s2["shown"] and s2["activeVisible"], f"{width}: {pick} is not in the row after picking {s2}"
        assert s2["scroll"][0] <= s2["scroll"][1] + 1 and not s2["outside"], s2
        assert set(s2["overflowed"]) | set(s2["shown"]) == set(s["overflowed"]) | set(s["shown"]), "a tab was lost"
        assert page.evaluate("() => new URLSearchParams(location.search).get('tab')") == pick, "the address follows"
    else:
        assert not s["moreShown"], f"{width}: More shows with nothing behind it"


def check_keys_and_resize(page) -> None:
    page.set_viewport_size({"width": 400, "height": 900})
    time.sleep(0.3)
    page.focus("#tab-more")
    page.keyboard.press("Enter")
    page.wait_for_selector(".go-menu")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Escape")
    page.wait_for_selector(".go-menu", state="detached")
    assert page.evaluate("() => document.activeElement.id") == "tab-more", "Escape returns focus to More"
    assert page.get_attribute("#tab-more", "aria-expanded") == "false"
    # growing the window brings tabs back out of More; shrinking sends them in
    page.set_viewport_size({"width": 1280, "height": 900})
    time.sleep(0.3)
    wide = len(page.evaluate(STATE)["overflowed"])
    page.set_viewport_size({"width": 400, "height": 900})
    time.sleep(0.3)
    assert len(page.evaluate(STATE)["overflowed"]) > wide, "a narrower window puts more tabs behind More"


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("tab overflow test skipped: Playwright is not installed")
        raise SystemExit(0)
    from sim import season
    from test_offseason import finished
    done = season.new_season("smu", "full", seed=33, career=True)
    finished(done)
    season.save_season(done)
    sid = done["id"]
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
                print(f"tab overflow test skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.dismiss())
            for width in (1280, 1024, 768, 400):
                page.set_viewport_size({"width": width, "height": 900})
                page.goto(f"{base}/index.html?id={sid}&tab=offseason")
                page.wait_for_selector("#tab-offseason .off-steps", timeout=120_000)
                time.sleep(0.5)
                n = page.evaluate("() => document.querySelectorAll('#season-tabs button[data-tab]').length")
                assert n == 17, n
                check_width(page, width, phone=width <= 400)
            # the open tab keeps a slot even when it would be the one to overflow (the last tab, Summary)
            page.set_viewport_size({"width": 400, "height": 900})
            page.goto(f"{base}/index.html?id={sid}&tab=summary")
            page.wait_for_selector("#tab-summary:not([hidden])", timeout=120_000)
            time.sleep(0.5)
            s = page.evaluate(STATE)
            assert s["active"] == "summary" and s["activeVisible"] and "summary" in s["shown"], s
            assert s["scroll"][0] <= s["scroll"][1] + 1 and not s["outside"], s
            check_keys_and_resize(page)
            browser.close()
        assert not errors, errors
        print("tab overflow ok: no sideways scroll at 1280, 1024, 768 and 400; More lists the hidden tabs; the open tab stays in the row")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
