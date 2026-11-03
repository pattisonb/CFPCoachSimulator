"""The Scouting tab, queue first (web/scouting.js), in a browser: the queue's first rows are in the first viewport at
1280 and the page is well under half its old height; Manage Scouts opens over the tab and an area change patches the
strip in place with a toast; All Reports opens with the full by-scout view and its Flags tab; a refresh restores an
open All Reports (and Manage Scouts) from the address; the This Week digest lists the week's finds (a flag or a Likes
Him find); a prospect's name opens his profile over the tab with the board unchanged and the tab still Scouting; on a
phone the rows fit the card (Send in view, no sideways scroll) and the digest folds above the queue.
The save is seeded before the server starts: full reports on the class's top prospects this week, so finds exist.
Needs Playwright with a Chromium; without one it is skipped. (Run as a file: multiprocessing on Windows.)"""
import os
import random
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch   # noqa: E402
from test_deep_links import modals, params, reload, tab_on, wait_url   # noqa: E402
from test_ux_sweep import open_tab, toasted   # noqa: E402

OLD_HEIGHT_1280 = 3621          # the old Scouting page at 1280 (scouts and reports over the queue)


def board_ids(base, sid) -> set:
    return {b["id"] for b in call(base, f"/api/season/{sid}/recruiting")["board"]}


def check_first_viewport(page, base, sid, errors) -> None:
    page.set_viewport_size({"width": 1280, "height": 1000})
    open_tab(page, base, sid, "scouting", ".sc-table .sc-row")
    page.evaluate("() => window.scrollTo(0, 0)")
    rows = page.evaluate("() => [...document.querySelectorAll('.sc-table .sc-row')].slice(0, 3).map(r => r.getBoundingClientRect().bottom)")
    assert len(rows) == 3 and all(b <= 1000 for b in rows), f"the queue's first rows sit in the first viewport: {rows}"
    height = page.evaluate("() => document.documentElement.scrollHeight")
    assert height < OLD_HEIGHT_1280 / 2, f"the page is well under half its old height: {height}"
    assert not page.query_selector("#tab-scouting .sc-scout"), "the full scout rows are not on the page, only in Manage Scouts"
    assert page.query_selector(".sc-strip .sc-scout-chip"), "the scouts strip"
    pot = page.evaluate("() => [...document.querySelectorAll('.sc-table .sc-row .sc-pot')].filter(p => p.getClientRects().length > 1 || p.offsetHeight > 30).length")
    assert pot == 0, "every potential read sits on one line"
    assert not errors, errors


def check_digest(page, base, sid, errors) -> None:
    v = call(base, f"/api/season/{sid}/scouting")
    finds = {it["pid"] for g in v["reports"]["this_week"] for it in g["items"] if it["flags"] or it["likes"]}
    assert finds, "the seeded week has finds"
    page.wait_for_selector(".sc-digest[open] [data-key=finds] .sc-dg-item", timeout=15_000)
    shown = page.eval_on_selector_all(".sc-digest [data-key=finds] .sc-dg-item", "els => els.map(e => [e.dataset.pid, e.textContent])")
    assert shown and all(pid in finds for pid, _ in shown), shown[:3]
    assert all(any(w in t for w in ("Generational", "Gem", "Bust Risk", "Likes Him")) for _, t in shown), shown[:3]
    assert page.query_selector(".sc-digest #sc-all-reports"), "the digest ends with All Reports"


def check_name_opens_profile(page, base, sid, errors) -> None:
    before = board_ids(base, sid)
    pid = page.evaluate("() => { const r = [...document.querySelectorAll('.sc-table .sc-row')].find(r => !r.classList.contains('on-board')); return r && r.dataset.pid; }")
    assert pid, "a queue row off the board"
    name = page.inner_text(f".sc-row[data-pid='{pid}'] .sc-name")
    page.click(f".sc-row[data-pid='{pid}'] .sc-name")
    page.wait_for_selector(".modal:not([hidden]) .rc-profile .go-display, .modal:not([hidden]) .rc-profile h2, .modal:not([hidden]) .rc-profile", timeout=30_000)
    p = wait_url(page, lambda p: p["modal"] == [f"profile:{pid}"], f"modal=profile:{pid}")
    assert p.get("tab") == "scouting" and tab_on(page, "scouting"), "the tab stays Scouting"
    page.wait_for_function("(n) => [...document.querySelectorAll('.modal:not([hidden])')].some(m => m.textContent.toLowerCase().includes(n))", arg=name.lower(), timeout=30_000)
    assert board_ids(base, sid) == before, "opening his profile leaves the board as it was"
    page.keyboard.press("Escape")
    page.wait_for_function("() => ![...document.querySelectorAll('.modal')].some(m => !m.hidden)", timeout=10_000)
    assert tab_on(page, "scouting") and board_ids(base, sid) == before
    assert not errors, errors


def check_manage(page, base, sid, errors) -> None:
    v = call(base, f"/api/season/{sid}/scouting")
    tbody = page.query_selector(".sc-table tbody")
    chips = page.query_selector(".sc-strip .sc-strip-list")
    page.click("#sc-manage")
    page.wait_for_selector(".modal:not([hidden]) .sc-block-scouts .sc-scout", timeout=15_000)
    wait_url(page, lambda p: p["modal"] == ["scouts"], "modal=scouts")
    assert page.evaluate("() => document.querySelectorAll('.modal:not([hidden]) .sc-scout').length") == len(v["scouts"]) == 5
    assert all(page.query_selector(f".modal:not([hidden]) .sc-scout[data-key='{m['id']}'] .sc-bar") for m in v["scouts"]), "each scout carries his narrowed bar"
    scout = v["scouts"][0]
    sel = f"#area-{scout['id']}"
    other = next(a for a in page.eval_on_selector_all(f"{sel} option", "els => els.map(e => e.value)") if a and a != scout["area"])
    page.select_option(sel, other)
    toasted(page, f"{scout['name']} now scouts {other}.")
    page.wait_for_function("([id, a]) => { const c = document.querySelector(`.sc-strip .sc-scout-chip[data-key='${id}'] .sc-chip-area`); return c && c.textContent === a; }",
                           arg=[scout["id"], other], timeout=10_000)
    assert page.evaluate("(e) => e.isConnected", chips), "the strip patched in place"
    assert page.evaluate("(e) => e.isConnected", tbody), "the queue was never redrawn"
    assert page.evaluate("() => document.querySelectorAll('.modal:not([hidden]) .sc-scout').length") == 5, "the list keeps every scout"
    reload(page, ".modal:not([hidden]) .sc-block-scouts .sc-scout")
    assert params(page)["modal"] == ["scouts"] and tab_on(page, "scouting"), "a refresh reopens Manage Scouts"
    assert page.eval_on_selector(sel, "e => e.value") == other
    page.keyboard.press("Escape")
    page.wait_for_function("() => ![...document.querySelectorAll('.modal')].some(m => !m.hidden)", timeout=10_000)
    wait_url(page, lambda p: p["modal"] == [], "no modal")
    assert not errors, errors


def check_reports(page, base, sid, errors) -> None:
    v = call(base, f"/api/season/{sid}/scouting")
    page.wait_for_selector("#sc-all-reports", timeout=60_000)
    page.click("#sc-all-reports")
    page.wait_for_selector(".modal:not([hidden]) .sc-reports .go-subtabs", timeout=15_000)
    wait_url(page, lambda p: p["modal"] == ["reports"], "modal=reports")
    groups = page.eval_on_selector_all(".modal:not([hidden]) .sc-reports .sc-report", "els => els.map(e => e.dataset.key)")
    assert groups == [g["scout_id"] for g in v["reports"]["this_week"]], (groups, [g["scout_id"] for g in v["reports"]["this_week"]])
    for g in v["reports"]["this_week"]:
        n = len(g["items"])
        if n > 8:
            assert page.inner_text(f".modal:not([hidden]) .sc-report[data-key='{g['scout_id']}'] .sc-report-more") == f"Show All {n}", "a long report folds behind Show All"
    assert page.get_attribute(".modal:not([hidden]) .sc-reports button[data-week=this_week]", "aria-selected") == "true"
    page.click(".modal:not([hidden]) .sc-reports button[data-week=flags]")
    wait_url(page, lambda p: p["modal"] == ["reports:flags"], "modal=reports:flags")
    assert page.evaluate("() => document.querySelectorAll('.modal:not([hidden]) .sc-flag').length") == len(v["flags"])
    reload(page, ".modal:not([hidden]) .sc-reports button[data-week=flags][aria-selected=true]")
    assert params(page)["modal"] == ["reports:flags"] and tab_on(page, "scouting"), "a refresh restores All Reports on its Flags tab"
    # a name in the reports opens his profile on top; the tab stays Scouting and the board as it was
    before = board_ids(base, sid)
    pid = page.eval_on_selector(".modal:not([hidden]) .sc-flag .go-link", "e => e.dataset.pid")
    page.click(f".modal:not([hidden]) .sc-flag .go-link[data-pid='{pid}']")
    wait_url(page, lambda p: p["modal"] == ["reports:flags", f"profile:{pid}"], "the profile over All Reports")
    page.wait_for_function("() => [...document.querySelectorAll('.modal')].filter(m => !m.hidden).length === 2", timeout=15_000)
    assert tab_on(page, "scouting") and board_ids(base, sid) == before
    page.keyboard.press("Escape")
    page.wait_for_function("() => [...document.querySelectorAll('.modal')].filter(m => !m.hidden).length === 1", timeout=10_000)
    page.click(".modal:not([hidden]) .sc-reports button[data-week=last_week]")
    wait_url(page, lambda p: p["modal"] == ["reports:last_week"], "modal=reports:last_week")
    page.keyboard.press("Escape")
    wait_url(page, lambda p: p["modal"] == [], "no modal")
    assert modals(page) == 0
    assert not errors, errors


def check_phone(page, base, sid, errors) -> None:
    page.set_viewport_size({"width": 400, "height": 860})
    open_tab(page, base, sid, "scouting", ".sc-table .sc-row")
    assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways scroll on a phone"
    r = page.evaluate("() => { const b = document.querySelector('.sc-table .sc-row .sc-send:not([hidden])'); const x = b.getBoundingClientRect(); return [x.right, x.height]; }")
    assert r[0] <= 400 and r[1] >= 44, f"Send sits in the row, 44 px tall: {r}"
    assert not page.evaluate("() => document.querySelector('.sc-digest').open"), "the digest folds on a phone"
    q, d = page.evaluate("() => [document.querySelector('.sc-queue-panel').getBoundingClientRect().top, document.querySelector('.sc-digest').getBoundingClientRect().top]")
    assert d < q, "the folded digest sits above the queue"
    page.click(".sc-digest .sc-dg-head")
    page.wait_for_selector(".sc-digest[open] #sc-all-reports:visible", timeout=5_000)
    for sel in ("#sc-manage", "#sc-all-reports", ".sc-digest .sc-dg-head", ".sc-pager .go-btn"):
        h = page.eval_on_selector(sel, "e => e.getBoundingClientRect().height")
        assert h >= 44, f"{sel} is {h} px tall on a phone"
    page.set_viewport_size({"width": 1280, "height": 1000})
    assert not errors, errors


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("scouting layout skipped: Playwright is not installed")
        raise SystemExit(0)
    from coach_career import recruiting
    from sim import season
    st = season.new_season("smu", "full", seed=62, career=True)
    rc = st["recruiting"]
    top = sorted((pid for pid in recruiting.visible(st)), key=lambda pid: rc["prospects"][pid]["rank"])[:30]
    for i, pid in enumerate(top):            # full reports this week on the class's top 30: gems, generational reads, Likes Him finds
        recruiting.look(st, pid, 90, random.Random(f"layout-{i}"), by="trip", weight=recruiting.REPORT_LOOKS)
    season.save_season(st)
    A = st["id"]
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port), "CFP_QUESTION_RATE": "0"},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(base + "/api/teams", timeout=2)
                break
            except OSError:
                time.sleep(0.5)
        for pid in top[:3]:
            call(base, f"/api/season/{A}/board", {"pid": pid, "on": True})
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"scouting layout skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.dismiss())
            check_first_viewport(page, base, A, errors)
            check_digest(page, base, A, errors)
            check_name_opens_profile(page, base, A, errors)
            check_manage(page, base, A, errors)
            check_reports(page, base, A, errors)
            check_phone(page, base, A, errors)
            browser.close()
        print("scouting layout ok: the queue in the first viewport, the digest's finds, a name opens his profile over the tab "
              "(board unchanged), Manage Scouts patches in place and reloads, All Reports by scout reloads on Flags, a phone fits")
    finally:
        try:
            call(base, f"/api/season/{A}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
