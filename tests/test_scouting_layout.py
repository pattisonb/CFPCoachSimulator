"""The Scouting tab, the Scouting Center (web/scouting.js), in a browser: the database's first rows and the selected
prospect's report are in the first viewport at 1280 and the page is well under half its old height; the stat cards
read the API; the ratings are grade words, never invented numbers; a row fills the report without leaving the tab and
a refresh restores him and the sub-tab; Send Scout patches the row's meter; Add to Board flips the star and Remove
flips it back; a flagged row carries its badge and the Scouting sub-tab its flags; Scouting Operations opens the
staff rows, an area change patches in place and a refresh keeps it open; All Reports opens by scout and a refresh
restores it on Flags; a name there opens his profile with the board unchanged; on a phone the cards are 2×2, the
report stacks under the database, the controls are 44 px and nothing scrolls sideways.
The save is seeded before the server starts: full reports on the class's top prospects this week, so finds exist.
Needs Playwright with a Chromium; without one it is skipped. (Run as a file: multiprocessing on Windows.)"""
import os
import random
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
from test_deep_links import modals, params, reload, tab_on, wait_url   # noqa: E402
from test_ux_sweep import open_tab, toasted, toasted_start   # noqa: E402

OLD_HEIGHT_1280 = 3621          # the old Scouting page at 1280 (scouts and reports over the queue)
NO_MODAL = "() => ![...document.querySelectorAll('.modal')].some(m => !m.hidden)"


def board_ids(base, sid) -> set:
    return {b["id"] for b in call(base, f"/api/season/{sid}/recruiting")["board"]}


def intel_name(page) -> str:
    return page.inner_text(".sc-intel .sc-big-name").strip()


def wait_intel(page, name: str) -> None:
    page.wait_for_function("(n) => { const e = document.querySelector('.sc-intel .sc-big-name'); return e && e.textContent.trim() === n && !document.querySelector('.sc-intel[aria-busy]'); }",
                           arg=name, timeout=30_000)


def check_first_viewport(page, base, sid, errors) -> None:
    page.set_viewport_size({"width": 1280, "height": 1000})
    open_tab(page, base, sid, "scouting", ".sc-list .sc-row")
    page.wait_for_selector(".sc-intel .sc-big-name", timeout=30_000)
    page.evaluate("() => window.scrollTo(0, 0)")
    v = call(base, f"/api/season/{sid}/scouting")
    first = v["queue"][0]
    wait_intel(page, first["name"])
    assert params(page).get("spid") == first["pid"], "before anything is picked, the first row is selected (and in the address)"
    rows = page.evaluate("() => [...document.querySelectorAll('.sc-list .sc-row')].slice(0, 3).map(r => r.getBoundingClientRect().bottom)")
    assert len(rows) == 3 and all(b <= 1000 for b in rows), f"the database's first rows sit in the first viewport: {rows}"
    assert page.evaluate("() => document.querySelector('.sc-intel .sc-boxes').getBoundingClientRect().bottom") <= 1000, "the report's head and boxes are in the first viewport"
    height = page.evaluate("() => document.documentElement.scrollHeight")
    assert height < OLD_HEIGHT_1280 / 2, f"the page is well under half its old height: {height}"
    stats = page.eval_on_selector_all(".sc-stats .sc-stat", "els => els.map(e => e.dataset.stat + ':' + e.querySelector('.sc-stat-value').textContent)")
    assert stats == [f"board:{len(board_ids(base, sid))}", f"full:{v['full_reports']}", f"trips:{v['trips_this_week']}", f"points:{v['points_left']}"], stats
    assert page.eval_on_selector(".sc-intel .sc-subtabs button[data-sub=ratings]", "e => e.getAttribute('aria-selected')") == "true"
    words = page.eval_on_selector_all(".sc-intel .sc-skill .sc-skill-val", "els => els.map(e => e.textContent.trim())")
    assert words and all(re.fullmatch(r"(Weak|Fair|Solid|Strong|Elite|All-American)(–(Weak|Fair|Solid|Strong|Elite|All-American))?|Not Read", w) for w in words), \
        f"the ratings are the staff's grade words, never invented numbers: {words}"
    assert not page.query_selector("#tab-scouting .sc-ops-body:not([hidden])"), "the staff rows are folded under Scouting Operations"
    assert not errors, errors


def check_select_and_subtab(page, base, sid, errors) -> None:
    before = board_ids(base, sid)
    lst = page.query_selector(".sc-list")
    li = page.query_selector(".sc-list .sc-row:nth-child(2)")
    pid = li.get_attribute("data-pid")
    name = page.inner_text(f".sc-row[data-pid='{pid}'] .sc-name")
    page.click(f".sc-row[data-pid='{pid}'] .sc-row-btn")
    wait_intel(page, name)
    p = wait_url(page, lambda p: p.get("spid") == pid, f"spid={pid}")
    assert p.get("tab") == "scouting" and tab_on(page, "scouting") and modals(page) == 0, "a row fills the report without leaving the tab"
    assert page.get_attribute(f".sc-row[data-pid='{pid}'] .sc-row-btn", "aria-pressed") == "true"
    assert page.evaluate("(e) => e.isConnected", lst), "the list was never redrawn"
    assert board_ids(base, sid) == before, "selecting him leaves the board as it was"
    page.click(".sc-intel .sc-subtabs button[data-sub=overview]")
    page.wait_for_selector(".sc-intel .sc-facts", timeout=10_000)
    wait_url(page, lambda p: p.get("ssub") == "overview", "ssub=overview")
    reload(page, ".sc-intel .sc-facts")
    wait_intel(page, name)
    assert params(page).get("spid") == pid and page.get_attribute(".sc-intel .sc-subtabs button[data-sub=overview]", "aria-selected") == "true", \
        "a refresh restores the selected prospect and the sub-tab"
    page.click(".sc-intel .sc-subtabs button[data-sub=ratings]")
    wait_url(page, lambda p: p.get("ssub") is None, "ssub dropped on Ratings")
    assert not errors, errors


def check_send_and_board(page, base, sid, errors) -> None:
    v = call(base, f"/api/season/{sid}/scouting?limit=400")
    row = next(r for r in v["queue"] if r["can_send"] and not r["on_board"] and (r["looks"] or 0) <= 1)
    pid = row["pid"]
    page.fill("#sc-search", row["name"])           # the class's top rows are fully scouted here: find him by name
    page.wait_for_selector(f".sc-row[data-pid='{pid}']", timeout=10_000)
    page.click(f".sc-row[data-pid='{pid}'] .sc-row-btn")
    wait_intel(page, row["name"])
    lst = page.query_selector(".sc-list")
    fmt = lambda n: str(int(n)) if float(n) == int(n) else f"{n:.1f}"
    before, after = row["looks"] or 0, min(3, (row["looks"] or 0) + 1)
    assert page.inner_text(f".sc-row[data-pid='{pid}'] .sc-looks-text") == f"{fmt(before)}/3"
    page.click("#sc-send")
    toasted_start(page, f"Scouted {row['name']} · {fmt(after)} of 3 looks" + (" · his report is complete" if after >= 3 else ""))
    page.wait_for_function("([pid, t]) => document.querySelector(`.sc-row[data-pid='${pid}'] .sc-looks-text`).textContent === t", arg=[pid, f"{fmt(after)}/3"], timeout=10_000)
    segs = page.evaluate("(pid) => [...document.querySelectorAll(`.sc-row[data-pid='${pid}'] .sc-trip`)].map(t => t.classList.contains('on') ? 1 : t.classList.contains('half') ? 0.5 : 0)", pid)
    assert segs == [min(1, max(0, after - i)) for i in range(3)], segs
    assert not page.query_selector(".sc-intel .sc-result"), "no first-read box after a trip (the player removed it)"
    page.wait_for_function("(h) => document.querySelector('#sc-points').textContent.startsWith('Points Left: ' + h + ' of')", arg=v["points_left"] - row["cost"], timeout=10_000)
    assert page.evaluate("(e) => e.isConnected", lst) and tab_on(page, "scouting")
    # Add to Board flips the star; Remove from Board flips it back (no offer out: no confirm)
    assert page.inner_text(f".sc-row[data-pid='{pid}'] .sc-star") == "☆"
    page.click("#sc-board")
    toasted(page, f"{row['name']} is on your board.")
    page.wait_for_function("(pid) => document.querySelector(`.sc-row[data-pid='${pid}'] .sc-star`).textContent === '★'", arg=pid, timeout=10_000)
    assert pid in board_ids(base, sid) and page.inner_text("#sc-board").strip() == "★ Remove from Board"
    assert page.inner_text(".sc-stat[data-stat=board] .sc-stat-value") == str(len(board_ids(base, sid)))
    page.click("#sc-board")
    toasted(page, f"{row['name']} is off your board.")
    page.wait_for_function("(pid) => document.querySelector(`.sc-row[data-pid='${pid}'] .sc-star`).textContent === '☆'", arg=pid, timeout=10_000)
    assert pid not in board_ids(base, sid) and tab_on(page, "scouting")
    assert page.evaluate("(e) => e.isConnected", lst), "the list was never redrawn"
    page.fill("#sc-search", "")
    page.wait_for_function("() => document.querySelectorAll('.sc-row').length > 5", timeout=10_000)
    assert not errors, errors


def check_complete_stays(page, base, sid, pid, name, errors) -> None:
    """The player's report: a prospect off the board, scouted to a full report by hand, must not vanish. He stays
    in the list (Complete, no Send), shows under Scouted, and is still there after a refresh."""
    page.fill("#sc-search", name)
    page.wait_for_selector(f".sc-row[data-pid='{pid}']", timeout=10_000)
    page.click(f".sc-row[data-pid='{pid}'] .sc-row-btn")
    wait_intel(page, name)
    page.click("#sc-send")
    toasted_start(page, f"Scouted {name} · 3 of 3 looks · his report is complete")
    page.wait_for_function("(pid) => document.querySelector(`.sc-row[data-pid='${pid}'] .sc-looks-text`)?.textContent === '3/3'", arg=pid, timeout=10_000)
    assert intel_name(page) == name, "the report still shows him"
    page.wait_for_function("() => document.querySelector('#sc-send').disabled && /complete/.test(document.querySelector('.sc-why')?.textContent || '')", timeout=10_000)   # a complete report: no Send
    page.click(".sc-chips [data-board=scouted]")
    page.wait_for_selector(f".sc-row[data-pid='{pid}']", timeout=10_000)
    reload(page)
    wait_intel(page, name)            # still selected after a refresh (the search is not in the address, so he may be on a later page)
    assert pid not in board_ids(base, sid) and tab_on(page, "scouting")
    page.click(".sc-chips [data-board=all]")
    page.fill("#sc-search", "")
    page.wait_for_function("() => document.querySelectorAll('.sc-row').length > 5", timeout=10_000)
    assert not errors, errors


def check_sort(page, base, sid, errors) -> None:
    """The player's report: the sort did nothing (it reordered only the page on screen). The list is every prospect,
    by rank by default; a sort orders the whole class (the first row is the class's best by it) and a refresh keeps it."""
    rows = lambda: page.eval_on_selector_all(".sc-row", "els => els.map(e => e.dataset.pid)")
    first = call(base, f"/api/season/{sid}/scouting?limit=20")["queue"]
    assert first[0]["national_rank"] == 1 and [r["national_rank"] for r in first] == sorted(r["national_rank"] for r in first), "rank by default"
    assert rows()[:5] == [r["pid"] for r in first[:5]], (rows()[:5], [r["pid"] for r in first[:5]])
    for key in ("looks", "need", "rank"):
        want = call(base, f"/api/season/{sid}/scouting?limit=20&sort={key}")["queue"]
        page.select_option("#sc-sort", key)
        page.wait_for_function("(p) => document.querySelector('.sc-row')?.dataset.pid === p", arg=want[0]["pid"], timeout=10_000)
        assert rows()[:5] == [r["pid"] for r in want[:5]], key
        assert params(page).get("ssort", "rank") == key
    whole = call(base, f"/api/season/{sid}/scouting?limit=400&sort=looks")["queue"]
    assert whole[0]["looks"] == max(r["looks"] or 0 for r in whole), "looks sorts the whole class, most first"
    page.select_option("#sc-sort", "looks")
    page.wait_for_function("(p) => document.querySelector('.sc-row')?.dataset.pid === p", arg=whole[0]["pid"], timeout=10_000)
    reload(page)
    page.wait_for_function("(p) => document.querySelector('.sc-row')?.dataset.pid === p", arg=whole[0]["pid"], timeout=60_000)
    assert page.input_value("#sc-sort") == "looks", "the sort survives a refresh"
    page.select_option("#sc-sort", "rank")
    page.wait_for_function("(p) => document.querySelector('.sc-row')?.dataset.pid === p", arg=first[0]["pid"], timeout=10_000)
    assert not errors, errors


def check_flags(page, base, sid, errors) -> None:
    v = call(base, f"/api/season/{sid}/scouting?limit=400")
    flagged = next(r for r in v["queue"] if r["flags"] or r["likes"])
    assert page.query_selector(f".sc-row[data-pid='{flagged['pid']}'] .sc-row-flags .go-badge, .sc-row[data-pid='{flagged['pid']}'] .sc-row-flags .go-tag"), "the row carries a small flag badge"
    page.click(f".sc-row[data-pid='{flagged['pid']}'] .sc-row-btn")
    wait_intel(page, flagged["name"])
    page.click(".sc-intel .sc-subtabs button[data-sub=scouting]")
    page.wait_for_selector(".sc-intel .sc-sc-flags", timeout=10_000)
    text = page.inner_text(".sc-intel .sc-sc-flags")
    assert any(w.lower() in text.lower() for w in ("Generational", "Gem", "Bust Risk", "Likes Him")), text
    assert page.get_attribute("#sc-all-reports .sc-new-n", "hidden") is None, "All Reports counts this week's finds"
    page.click(".sc-intel .sc-subtabs button[data-sub=ratings]")
    assert not errors, errors


def check_ops(page, base, sid, errors) -> None:
    v = call(base, f"/api/season/{sid}/scouting")
    page.click("#sc-manage")
    page.wait_for_selector(".sc-ops-body .sc-scout", timeout=10_000)
    wait_url(page, lambda p: p.get("sops") == "1", "sops=1")
    assert page.evaluate("() => document.querySelectorAll('.sc-ops-body .sc-scout').length") == len(v["scouts"]) == 5
    assert all(page.query_selector(f".sc-ops-body .sc-scout[data-key='{m['id']}'] .sc-bar") for m in v["scouts"]), "each scout carries his narrowed bar"
    lst = page.query_selector(".sc-list")
    scout = v["scouts"][0]
    sel = f"#area-{scout['id']}"
    other = next(a for a in page.eval_on_selector_all(f"{sel} option", "els => els.map(e => e.value)") if a and a != scout["area"])
    page.select_option(sel, other)
    toasted(page, f"{scout['name']} now scouts {other}.")
    page.wait_for_function("(a) => document.querySelector('.sc-ops-summary').textContent.includes(a)", arg=other, timeout=10_000)
    assert page.evaluate("() => document.querySelectorAll('.sc-ops-body .sc-scout').length") == 5 and page.evaluate("(e) => e.isConnected", lst)
    reload(page, ".sc-ops-body .sc-scout")
    assert params(page).get("sops") == "1" and page.eval_on_selector(sel, "e => e.value") == other, "a refresh keeps Scouting Operations open"
    page.click("#sc-manage")
    wait_url(page, lambda p: p.get("sops") is None, "sops dropped")
    assert not errors, errors


def check_reports(page, base, sid, errors) -> None:
    v = call(base, f"/api/season/{sid}/scouting")
    page.click("#sc-all-reports")
    page.wait_for_selector(".modal:not([hidden]) .sc-reports .go-subtabs", timeout=15_000)
    wait_url(page, lambda p: p["modal"] == ["reports"], "modal=reports")
    groups = page.eval_on_selector_all(".modal:not([hidden]) .sc-reports .sc-report", "els => els.map(e => e.dataset.key)")
    assert groups == [g["scout_id"] for g in v["reports"]["this_week"]], groups
    for g in v["reports"]["this_week"]:
        if len(g["items"]) > 8:
            assert page.inner_text(f".modal:not([hidden]) .sc-report[data-key='{g['scout_id']}'] .sc-report-more") == f"Show All {len(g['items'])}"
    page.click(".modal:not([hidden]) .sc-reports button[data-week=flags]")
    wait_url(page, lambda p: p["modal"] == ["reports:flags"], "modal=reports:flags")
    assert page.evaluate("() => document.querySelectorAll('.modal:not([hidden]) .sc-flag').length") == len(v["flags"])
    reload(page, ".modal:not([hidden]) .sc-reports button[data-week=flags][aria-selected=true]")
    assert params(page)["modal"] == ["reports:flags"] and tab_on(page, "scouting"), "a refresh restores All Reports on its Flags tab"
    before = board_ids(base, sid)
    pid = page.eval_on_selector(".modal:not([hidden]) .sc-flag .go-link", "e => e.dataset.pid")
    page.click(f".modal:not([hidden]) .sc-flag .go-link[data-pid='{pid}']")
    wait_url(page, lambda p: p["modal"] == ["reports:flags", f"profile:{pid}"], "the profile over All Reports")
    page.wait_for_function("() => [...document.querySelectorAll('.modal')].filter(m => !m.hidden).length === 2", timeout=15_000)
    assert tab_on(page, "scouting") and board_ids(base, sid) == before, "a name opens his profile: no board change, no tab switch"
    page.keyboard.press("Escape")
    page.wait_for_function("() => [...document.querySelectorAll('.modal')].filter(m => !m.hidden).length === 1", timeout=10_000)
    page.keyboard.press("Escape")
    wait_url(page, lambda p: p["modal"] == [], "no modal")
    page.wait_for_function(NO_MODAL, timeout=10_000)
    assert not errors, errors


def check_phone(page, base, sid, errors) -> None:
    page.set_viewport_size({"width": 400, "height": 860})
    open_tab(page, base, sid, "scouting", ".sc-list .sc-row")
    page.wait_for_selector(".sc-intel .sc-big-name", timeout=30_000)
    assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways scroll on a phone"
    tops = page.eval_on_selector_all(".sc-stats .sc-stat", "els => els.map(e => Math.round(e.getBoundingClientRect().top))")
    assert len(set(tops)) == 2 and tops[0] == tops[1] and tops[2] == tops[3], f"the stat cards are a 2×2 grid: {tops}"
    assert page.evaluate("() => document.querySelector('.sc-db').getBoundingClientRect().bottom <= document.querySelector('.sc-intel').getBoundingClientRect().top + 1"), "the report stacks under the database"
    for sel in ("#sc-all-reports", ".sc-row-btn", "#sc-search", ".sc-pager .go-btn", "#sc-send", "#sc-board", ".sc-intel .sc-subtabs button", "#sc-manage", ".sc-ops-toggle"):
        h = page.eval_on_selector(sel, "e => e.getBoundingClientRect().height")
        assert h >= 44, f"{sel} is {h} px tall on a phone"
    wide = page.evaluate("() => [...document.querySelectorAll('.sc-row-btn, .sc-intel *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).length")
    assert wide == 0, f"{wide} elements run past the screen"
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
    ranked = sorted((pid for pid in recruiting.visible(st)), key=lambda pid: rc["prospects"][pid]["rank"])
    top, near = ranked[:30], ranked[30]
    for i, pid in enumerate(top):            # full reports this week on the class's top 30: gems, generational reads, Likes Him finds
        recruiting.look(st, pid, 90, random.Random(f"layout-{i}"), by="trip", weight=recruiting.REPORT_LOOKS)
    recruiting.look(st, near, 90, random.Random("layout-near"), by="trip", weight=2)   # one trip from complete: the long Send label
    off = ranked[31]                          # off the board, one trip from complete: finishing him must not hide him
    recruiting.look(st, off, 90, random.Random("layout-off"), by="trip", weight=2)
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
        for pid in top[:3] + [near]:
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
            check_select_and_subtab(page, base, A, errors)
            check_sort(page, base, A, errors)
            check_send_and_board(page, base, A, errors)
            check_complete_stays(page, base, A, off, rc["prospects"][off]["name"], errors)
            check_flags(page, base, A, errors)
            check_ops(page, base, A, errors)
            check_reports(page, base, A, errors)
            check_phone(page, base, A, errors)
            browser.close()
        print("scouting layout ok: the database and the report in the first viewport, a row fills the report and a refresh restores him "
              "and the sub-tab, the sort orders the whole class and survives a refresh, Send patches the meter, Add to Board flips the star, flags on the rows and the Scouting sub-tab, "
              "Scouting Operations patches in place and reloads, All Reports by scout reloads on Flags, a name opens his profile, a phone fits")
    finally:
        try:
            call(base, f"/api/season/{A}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
