"""Board scrolling in a browser (docs/HOW_IT_WORKS.md "Board scrolling"): the Recruiting board and the Scouting Center
use one scroll model. With the list and the pane side by side (1280×800, 1024×768) the page itself does not scroll;
the list scrolls in its card and the pane in its column, each with overflow-y auto and overscroll-behavior contain, one
vertical scroller per column; the wheel over the list moves the list (not the pane, not the page) and over the pane
moves the pane; the last row and the pane's last card scroll fully into view; the list's search and the pane's tab row
stay put; a recruit picked by the keyboard or by an address shows in the list's own scroll, and the page never moves.
The Recruiting Timeline keeps its cap and hands the wheel on to the pane at its end. On a phone (400×760) the page is
the only scroller: the list and the pane have no inner scroll (the Recruiting pane is its full-screen sheet). No tab
row or chip row on the board, the pane, the sheet, the Scouting Center or the popup ever shows a scrollbar.
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
from test_ux_sweep import open_tab   # noqa: E402

DESKTOP = ((1280, 800), (1024, 768))
PHONE = (400, 760)
# each screen: its tab, a row, the list's scroll box, the pane, the pane's tab row, the list's search, the pane's cards
SCREENS = {
    "recruiting": {"row": ".go-row-recruit", "list": "#tab-recruiting .go-list-recruits", "pane": "#tab-recruiting .go-pane",
                   "tabrow": "#tab-recruiting .go-pane > .pv-tabrow", "search": "#rc-search", "card": "#tab-recruiting .go-pane .pv-card"},
    "scouting": {"row": ".sc-list .sc-row", "list": "#tab-scouting .sc-list-wrap", "pane": "#tab-scouting .sc-intel",
                 "tabrow": "#tab-scouting .sc-intel .pv-tabrow", "search": "#sc-search", "card": "#tab-scouting .sc-intel .pv-card"},
}

BOX = """(sel) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e), r = e.getBoundingClientRect();
  return { oy: cs.overflowY, ob: cs.overscrollBehaviorY, sh: e.scrollHeight, ch: e.clientHeight, st: e.scrollTop, top: r.top, bottom: r.top + e.clientTop + e.clientHeight }; }"""
DOC = "() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, y: scrollY })"
# the elements under a node that scroll up and down (a single stray pixel counts: a classic scrollbar shows for it)
SCROLLERS = """(sel) => { const root = document.querySelector(sel); if (!root) return [];
  return [root, ...root.querySelectorAll('*')].filter(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)
    .map(e => e.className || e.tagName); }"""
# Stray scrollbars (the player's "wtf is this": a tab row with tiny ▲ ▼ and ◀ ▶ bars): under the boards, the pane, the
# sheet and the popup, every box that may scroll (overflow auto or scroll) either is one of the intended scrollers or has
# nothing to scroll in either direction; a row meant to slide sideways by finger hides its bar and never scrolls up and
# down; and every tab row and chip row fits its box whatever its overflow says.
SCROLL_OK = ".go-list-recruits, .go-pane, .sc-list-wrap, .sc-intel, .pv-timeline, .modal-body, .go-menu"
SLIDE_OK = ".go-stages, .go-map-regions"
ROWS = ".go-subtabs, .pv-tabrow, .go-stages, .sc-chips, .sc-tools, .sc-toolbar, .go-pane-chips, .go-tags, .pv-acts, .go-tools, .go-seg, .sc-pager"
STRAY = """([ok, slide, rows]) => {
  const roots = ['#tab-recruiting:not([hidden])', '#tab-scouting:not([hidden])', '.go-pane.sheet', '.modal:not([hidden])']
    .flatMap(s => [...document.querySelectorAll(s)]);
  const seen = new Set(), bad = [];
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].map(c => '.' + c).join('');
  for (const root of roots) for (const e of [root, ...root.querySelectorAll('*')]) {
    if (seen.has(e) || !e.getClientRects().length) continue;
    seen.add(e);
    const cs = getComputedStyle(e), may = (v) => /(auto|scroll)/.test(v);
    const over = { y: e.scrollHeight - e.clientHeight, x: e.scrollWidth - e.clientWidth };
    if (e.matches(slide) && may(cs.overflowX)) {
      if (cs.overflowY !== 'hidden' || cs.scrollbarWidth !== 'none') bad.push(name(e) + ' slides sideways with a visible bar or up and down: ' + cs.overflowY + ' ' + cs.scrollbarWidth);
      continue;
    }
    if (e.matches(rows) && (over.y > 0 || over.x > 0)) { bad.push(name(e) + ' overflows its row: ' + JSON.stringify(over)); continue; }
    if (e === root && e.classList.contains('tab-body')) { if (over.x > 0) bad.push(name(e) + ' scrolls sideways'); continue; }
    if (e.matches(ok)) { if (over.x > 0 && may(cs.overflowX)) bad.push(name(e) + ' scrolls sideways: ' + over.x); continue; }
    if ((may(cs.overflowY) && over.y > 0) || (may(cs.overflowX) && over.x > 0)) bad.push(name(e) + ' shows a stray scrollbar: ' + JSON.stringify(over) + ' ' + cs.overflowX + '/' + cs.overflowY);
  }
  return bad; }"""


def box(page, sel):
    return page.evaluate(BOX, sel)


def doc(page):
    return page.evaluate(DOC)


def settle(page, t: float = 0.5) -> None:
    time.sleep(t)


def wheel_over(page, sel, dy: int) -> None:
    r = page.evaluate("(sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + Math.min(r.height / 2, 120)]; }", sel)
    page.mouse.move(*r)
    page.mouse.wheel(0, dy)
    settle(page)


def open_screen(page, base, sid, tab) -> None:
    sc = SCREENS[tab]
    open_tab(page, base, sid, tab, sc["row"])
    page.wait_for_selector(sc["pane"] + (" .pv-tabrow" if tab == "scouting" else ""), timeout=30_000)
    page.wait_for_function("() => !document.querySelector('.sc-intel[aria-busy]')", timeout=30_000)
    settle(page, 0.6)


def check_desktop(page, base, sid, tab, size) -> None:
    sc, where = SCREENS[tab], f"{tab} at {size[0]}×{size[1]}"
    page.set_viewport_size({"width": size[0], "height": size[1]})
    open_screen(page, base, sid, tab)
    d = doc(page)
    assert d["sh"] <= d["ih"] + 1, f"{where}: the page itself does not scroll: {d}"
    lst, pane = box(page, sc["list"]), box(page, sc["pane"])
    for name, b in (("list", lst), ("pane", pane)):
        assert b and b["oy"] == "auto" and b["ob"] == "contain", f"{where}: the {name} is a contained scroller: {b}"
        assert b["bottom"] <= d["ih"] + 1, f"{where}: the {name} ends on the screen: {b}"
    assert lst["sh"] > lst["ch"] + 40, f"{where}: the list is long enough to scroll here: {lst}"
    assert pane["sh"] > pane["ch"] + 40, f"{where}: the pane is long enough to scroll here: {pane}"
    # one vertical scroller per column
    assert page.evaluate(SCROLLERS, sc["list"].replace(" .go-list-recruits", " .go-list-col").replace(" .sc-list-wrap", " .sc-db")) == \
        page.evaluate(SCROLLERS, sc["list"]), f"{where}: the list's card has one scroller, the list"
    assert len(page.evaluate(SCROLLERS, sc["pane"])) == 1, f"{where}: the pane is its column's one scroller: {page.evaluate(SCROLLERS, sc['pane'])}"
    # the wheel over the list moves the list, not the pane, not the page; the search stays put
    search_top = page.evaluate("(s) => document.querySelector(s).getBoundingClientRect().top", sc["search"])
    wheel_over(page, sc["list"], 240)
    l2, p2 = box(page, sc["list"]), box(page, sc["pane"])
    assert l2["st"] > lst["st"], f"{where}: the wheel over the list scrolls the list: {lst['st']} -> {l2['st']}"
    assert p2["st"] == pane["st"] and doc(page)["y"] == 0, f"{where}: the wheel over the list moves neither the pane nor the page"
    assert abs(page.evaluate("(s) => document.querySelector(s).getBoundingClientRect().top", sc["search"]) - search_top) < 1, f"{where}: the list's search stays put"
    # the wheel over the pane moves the pane; its tab row pins at the top of its column
    wheel_over(page, sc["pane"], 300)
    l3, p3 = box(page, sc["list"]), box(page, sc["pane"])
    assert p3["st"] > p2["st"] and l3["st"] == l2["st"] and doc(page)["y"] == 0, f"{where}: the wheel over the pane scrolls only the pane: {p2} -> {p3}"
    row = page.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.top, r.bottom]; }", sc["tabrow"])
    assert p3["top"] - 1 <= row[0] and row[1] <= p3["bottom"], f"{where}: the pane's tab row stays in view at its top: {row} in {p3}"
    # at their ends: the last row and the last card show whole, and more wheel goes nowhere else
    page.evaluate("(s) => { const e = document.querySelector(s); e.scrollTop = e.scrollHeight; }", sc["list"])
    page.evaluate("(s) => { const e = document.querySelector(s); e.scrollTop = e.scrollHeight; }", sc["pane"])
    settle(page, 0.3)
    l4, p4 = box(page, sc["list"]), box(page, sc["pane"])
    last = page.evaluate("(s) => { const rows = document.querySelectorAll(s); const r = rows[rows.length - 1].getBoundingClientRect(); return [r.top, r.bottom]; }", sc["row"])
    assert l4["top"] <= last[0] and last[1] <= l4["bottom"] + 0.5, f"{where}: the last row scrolls fully into view: {last} in {l4}"
    card = page.evaluate("(s) => { const c = [...document.querySelectorAll(s)].filter(e => e.getClientRects().length); const r = c[c.length - 1].getBoundingClientRect(); return [r.top, r.bottom]; }", sc["card"])
    assert p4["top"] <= card[0] and card[1] <= p4["bottom"] + 0.5 and card[1] <= d["ih"], f"{where}: the pane's last card scrolls fully into view: {card} in {p4}"
    wheel_over(page, sc["list"], 400)
    wheel_over(page, sc["pane"], 400)
    l5, p5 = box(page, sc["list"]), box(page, sc["pane"])
    assert doc(page)["y"] == 0 and abs(l5["st"] - l4["st"]) < 2 and abs(p5["st"] - p4["st"]) < 2, \
        f"{where}: at their ends the wheel chains to nothing: {doc(page)} {l4} -> {l5} {p4} -> {p5}"


def check_selection_in_view(page, base, sid, ids, size) -> None:
    """A recruit picked by the keyboard, or by an address, shows in the list's own scroll; the page never moves."""
    where = f"selection at {size[0]}×{size[1]}"
    page.set_viewport_size({"width": size[0], "height": size[1]})
    open_screen(page, base, sid, "recruiting")
    page.focus(".go-row-recruit[aria-pressed=true]")
    for _ in range(12):
        page.keyboard.press("ArrowDown")
        time.sleep(0.12)
    settle(page)
    seen = page.evaluate("() => window.CFP.ui.inView(document.querySelector('.go-row-recruit[aria-pressed=true]'))")
    assert seen and doc(page)["y"] == 0, f"{where}: the row the arrows reached is in the list's view and the page stayed: {doc(page)}"
    assert box(page, SCREENS["recruiting"]["list"])["st"] > 0, f"{where}: the list scrolled to follow the keyboard"
    # an address with a recruit far down the list: his row is shown in the list
    rows = page.eval_on_selector_all(".go-row-recruit", "els => els.map(e => e.dataset.pid)")
    far = rows[-2]
    page.goto(f"{base}/index.html?id={sid}&tab=recruiting&pid={far}")
    page.wait_for_selector(f".go-row-recruit[data-pid='{far}'][aria-pressed=true]", timeout=60_000)
    settle(page, 0.8)
    assert page.evaluate("(p) => window.CFP.ui.inView(document.querySelector(`.go-row-recruit[data-pid='${p}']`))", far) and doc(page)["y"] == 0, \
        f"{where}: the address's recruit shows in the list's own scroll"
    # the Scouting Center: an address's prospect far down the page of rows
    page.goto(f"{base}/index.html?id={sid}&tab=scouting")
    page.wait_for_selector(".sc-list .sc-row", timeout=60_000)
    spid = page.eval_on_selector_all(".sc-list .sc-row", "els => els.map(e => e.dataset.pid)")[-2]
    page.goto(f"{base}/index.html?id={sid}&tab=scouting&spid={spid}")
    page.wait_for_selector(f".sc-row.selected[data-pid='{spid}']", timeout=60_000)
    settle(page, 0.8)
    assert page.evaluate("(p) => window.CFP.ui.inView(document.querySelector(`.sc-row[data-pid='${p}']`))", spid) and doc(page)["y"] == 0, \
        f"{where}: the address's prospect shows in the database's own scroll"
    # another prospect opens the report at his top
    page.evaluate("() => { const e = document.querySelector('#tab-scouting .sc-intel'); e.scrollTop = e.scrollHeight; }")
    other = page.eval_on_selector_all(".sc-list .sc-row", "els => els.map(e => e.dataset.pid)")[0]
    page.click(f".sc-row[data-pid='{other}'] .sc-row-btn")
    page.wait_for_selector(f".sc-row.selected[data-pid='{other}']", timeout=10_000)
    page.wait_for_function("() => !document.querySelector('.sc-intel[aria-busy]')", timeout=30_000)
    settle(page, 0.6)
    assert box(page, SCREENS["scouting"]["pane"])["st"] == 0, f"{where}: another prospect's report opens at his top"


def check_timeline(page, base, sid, pid, size) -> None:
    """The Recruiting Timeline keeps its cap inside the scrolling pane and hands the wheel on to the pane at its end."""
    where = f"timeline at {size[0]}×{size[1]}"
    page.set_viewport_size({"width": size[0], "height": size[1]})
    page.goto(f"{base}/index.html?id={sid}&tab=recruiting&pid={pid}&pane=history")
    page.wait_for_selector(".go-pane .pv-timeline", timeout=60_000)
    settle(page, 0.8)
    tl = page.evaluate("""() => { const u = document.querySelector('.go-pane .pv-timeline');
      while (u.children.length < 40) u.append(u.firstElementChild.cloneNode(true));
      const cs = getComputedStyle(u); return { oy: cs.overflowY, ob: cs.overscrollBehaviorY, sh: u.scrollHeight, ch: u.clientHeight }; }""")
    assert tl["oy"] == "auto" and tl["ob"] == "auto" and tl["sh"] > tl["ch"], f"{where}: the timeline scrolls in its card and does not trap the wheel: {tl}"
    # bring the timeline into the pane's view, run it to its end, then the wheel over it moves the pane
    page.evaluate("() => { const u = document.querySelector('.go-pane .pv-timeline'), p = document.querySelector('#tab-recruiting .go-pane');"
                  " p.scrollTop += u.getBoundingClientRect().top - p.getBoundingClientRect().top - 80; u.scrollTop = u.scrollHeight; }")
    settle(page, 0.3)
    before = box(page, SCREENS["recruiting"]["pane"])
    wheel_over(page, ".go-pane .pv-timeline", 200)
    after = box(page, SCREENS["recruiting"]["pane"])
    assert doc(page)["y"] == 0, f"{where}: at the timeline's end the wheel never reaches the page"
    # the pane takes the wheel when it has anything left to show (the timeline card is only as tall as the notes
    # beside it, so on a tall screen the History tab can fit the pane whole, and then nothing moves)
    if before["sh"] - before["ch"] - before["st"] > 2:
        assert after["st"] > before["st"], f"{where}: at the timeline's end the wheel goes on to the pane: {before['st']} -> {after['st']}"


def check_phone(page, base, sid) -> None:
    w, h = PHONE
    where = f"phone {w}×{h}"
    page.set_viewport_size({"width": w, "height": h})
    for tab in ("recruiting", "scouting"):
        sc = SCREENS[tab]
        open_tab(page, base, sid, tab, sc["row"])
        settle(page, 0.6)
        d = doc(page)
        assert d["sh"] > d["ih"] + 100, f"{where} {tab}: the page scrolls: {d}"
        lst = box(page, sc["list"])
        assert lst["sh"] <= lst["ch"] + 1, f"{where} {tab}: the list has no inner scroll: {lst}"
        if tab == "scouting":
            page.wait_for_selector(sc["tabrow"], timeout=30_000)
            pane = box(page, sc["pane"])
            assert pane["sh"] <= pane["ch"] + 1, f"{where} {tab}: the report has no inner scroll: {pane}"
        page.evaluate("() => window.scrollTo(0, 0)")
        wheel_over(page, sc["list"], 300)
        assert doc(page)["y"] > 0, f"{where} {tab}: the wheel over the list scrolls the page"
    # the Recruiting pane opens as its full-screen sheet with its back button; inside it nothing else scrolls
    open_tab(page, base, sid, "recruiting", SCREENS["recruiting"]["row"])
    page.evaluate("() => window.scrollTo(0, 0)")
    page.click(".go-row-recruit >> nth=0")
    page.wait_for_selector(".go-pane.sheet .go-pane-back", timeout=30_000)
    settle(page, 0.6)
    inner = page.evaluate(SCROLLERS, ".go-pane.sheet")
    assert inner == [inner[0]] and "sheet" in inner[0], f"{where}: the sheet is the one scroller while it is open: {inner}"
    page.click(".go-pane.sheet .go-pane-back")
    page.wait_for_selector(".go-pane.sheet", state="detached", timeout=10_000)


def stray(page, where: str) -> None:
    bad = page.evaluate(STRAY, [SCROLL_OK, SLIDE_OK, ROWS])
    assert not bad, f"{where}: stray scrollbars or overflowing rows: {bad}"


RECT = """(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
  return [r.top, r.left, r.width, r.height]; }"""
SHOTS = os.environ.get("BOARD_SCROLL_SHOTS")   # a folder: the tab switches are saved there as a frame strip


def same_rects(rects: dict, where: str) -> None:
    first = next(iter(rects.values()))
    for k, r in rects.items():
        assert r and all(abs(a - b) <= 1 for a, b in zip(r, first)), f"{where}: it moved or changed size on {k}: {rects}"


def switch(page, scope: str, sub: str) -> None:
    page.click(f"{scope} .go-subtabs button[data-sub={sub}]")
    page.wait_for_selector(f"{scope} .go-subtabs button[data-sub={sub}][aria-selected=true]", timeout=30_000)
    page.wait_for_function("() => !document.querySelector('.sc-intel[aria-busy]')", timeout=30_000)
    settle(page, 0.45)                               # past the row's settle (ui.js holdTabRow) and any glide


def check_still(page, base, sid, pid) -> None:
    """Tab switches hold still: the Prospect Profile popup keeps its place and size on every tab, and the tab row of the
    popup, the board's pane and the Scouting Center's report stays where it is, scrolled or not, at 1280×800 and 400×760."""
    for w, h in ((1280, 800), PHONE):
        page.set_viewport_size({"width": w, "height": h})
        # the popup, over the Scouting Center
        page.goto(f"{base}/index.html?id={sid}&tab=scouting&spid={pid}")
        page.wait_for_selector(".sc-intel .sc-full-profile", timeout=60_000)
        page.click(".sc-intel .sc-full-profile")
        page.wait_for_selector(".modal:not([hidden]) .pv-popup .go-subtabs", timeout=30_000)
        settle(page, 0.6)
        scope = ".modal:not([hidden])"
        subs = page.eval_on_selector_all(f"{scope} .go-subtabs button[data-sub]", "els => els.map(e => e.dataset.sub)")
        assert len(subs) == 4, subs
        for scrolled in (0, 260):
            panels, rows = {}, {}
            for sub in subs + subs[:1]:
                switch(page, scope, sub)
                if scrolled and sub == subs[0] and not panels:
                    page.evaluate("(y) => { document.querySelector('.modal:not([hidden]) .modal-body').scrollTop = y; }", scrolled)
                    settle(page, 0.2)
                key = f"{sub}{'' if sub not in panels else ' again'}"
                panels[key] = page.evaluate(RECT, f"{scope} .modal-panel")
                rows[key] = page.evaluate(RECT, f"{scope} .pv-popup > .pv-tabrow")
                if SHOTS and not scrolled:
                    page.screenshot(path=os.path.join(SHOTS, f"popup-{w}-{len(panels)}-{sub}.png"))
            same_rects(panels, f"the popup at {w} (body scrolled {scrolled})")
            same_rects(rows, f"the popup's tab row at {w} (body scrolled {scrolled})")
        page.keyboard.press("Escape")
        settle(page, 0.4)
        # the Scouting Center's report
        tops = {}
        for sub in ("looks", "profile", "report", "looks"):
            switch(page, ".sc-intel", sub)
            tops[f"{sub}{len(tops)}"] = page.evaluate(RECT, ".sc-intel .pv-tabrow")
        same_rects(tops, f"the Scouting Center's tab row at {w}")
        # the board's pane (the sheet on a phone), first at its top, then scrolled past the hero
        page.goto(f"{base}/index.html?id={sid}&tab=recruiting&pid={pid}")
        page.wait_for_selector(".go-pane .go-subtabs button[data-sub=overview][aria-selected=true]", timeout=60_000)
        settle(page, 0.6)
        for scrolled in (0, 400):
            tops = {}
            for sub in ("scouting", "profile", "history", "overview", "scouting"):
                switch(page, ".go-pane", sub)
                if scrolled and not tops:
                    page.evaluate("(y) => { document.querySelector('.go-pane.sheet') ? document.querySelector('.go-pane').scrollTop = y"
                                  " : (getComputedStyle(document.querySelector('.go-pane')).overflowY === 'auto' ? document.querySelector('.go-pane').scrollTop = y : window.scrollTo(0, y)); }", scrolled)
                    settle(page, 0.2)
                tops[f"{sub}{len(tops)}"] = page.evaluate("() => document.querySelector('.go-pane > .pv-tabrow').getBoundingClientRect().top")
            first = next(iter(tops.values()))
            assert all(abs(t - first) <= 1 for t in tops.values()), f"the pane's tab row moved across tab switches at {w} (scrolled {scrolled}): {tops}"


def check_no_stray_scrollbars(page, base, sid, pid) -> None:
    """No tab row or chip row on the board, the pane (or its sheet), the Scouting Center or the popup shows a scrollbar,
    on every sub-tab, at 1280 and 400."""
    for w, h in ((1280, 800), PHONE):
        page.set_viewport_size({"width": w, "height": h})
        phone = w < 760
        for sub in ("overview", "scouting", "profile", "history"):
            page.goto(f"{base}/index.html?id={sid}&tab=recruiting&pid={pid}" + (f"&pane={sub}" if sub != "overview" else ""))
            page.wait_for_selector(f".go-pane .go-subtabs button[data-sub={sub}][aria-selected=true]", timeout=60_000)
            settle(page, 0.6)
            stray(page, f"recruiting {sub} at {w}")
            if phone:
                break                                # a phone opens the sheet on the address's recruit once
        if phone:
            for sub in ("scouting", "profile", "history"):
                page.click(f".go-pane .go-subtabs button[data-sub={sub}]")
                page.wait_for_selector(f".go-pane .go-subtabs button[data-sub={sub}][aria-selected=true]", timeout=30_000)
                settle(page, 0.5)
                stray(page, f"recruiting sheet {sub} at {w}")
        for sub in ("report", "looks", "profile"):
            page.goto(f"{base}/index.html?id={sid}&tab=scouting&spid={pid}" + (f"&ssub={sub}" if sub != "report" else ""))
            page.wait_for_selector(f".sc-intel .sc-subtabs button[data-sub={sub}][aria-selected=true]", timeout=60_000)
            page.wait_for_function("() => !document.querySelector('.sc-intel[aria-busy]')", timeout=30_000)
            settle(page, 0.6)
            stray(page, f"scouting {sub} at {w}")
        # the popup: his full profile over the Scouting Center
        page.click(".sc-intel .sc-full-profile")
        page.wait_for_selector(".modal:not([hidden]) .go-subtabs, .modal:not([hidden]) .pv-tabrow", timeout=30_000)
        settle(page, 0.6)
        for sub in page.eval_on_selector_all(".modal:not([hidden]) .go-subtabs button[data-sub]", "els => els.map(e => e.dataset.sub)"):
            page.click(f".modal:not([hidden]) .go-subtabs button[data-sub={sub}]")
            settle(page, 0.5)
            stray(page, f"popup {sub} at {w}")
        page.keyboard.press("Escape")
        settle(page, 0.4)


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("board scroll skipped: Playwright is not installed")
        raise SystemExit(0)
    from coach_career import recruiting
    from sim import season
    st = season.new_season("smu", "full", seed=71, career=True)
    rc = st["recruiting"]
    ranked = sorted(recruiting.visible(st), key=lambda pid: rc["prospects"][pid]["rank"])
    for i, pid in enumerate(ranked[:24]):      # full reports on the class's top: long reports in the pane
        recruiting.look(st, pid, 90, random.Random(f"scroll-{i}"), by="trip", weight=recruiting.REPORT_LOOKS)
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
        for pid in ranked[:30]:                   # a board long enough to scroll
            call(base, f"/api/season/{A}/board", {"pid": pid, "on": True})
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"board scroll skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 800}, color_scheme="light")
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.dismiss())
            check_no_stray_scrollbars(page, base, A, ranked[0])
            check_still(page, base, A, ranked[0])
            for size in DESKTOP:
                for tab in SCREENS:
                    check_desktop(page, base, A, tab, size)
            check_selection_in_view(page, base, A, ranked, DESKTOP[0])
            check_timeline(page, base, A, ranked[0], DESKTOP[0])
            check_phone(page, base, A)
            assert not errors, errors
            browser.close()
        print("board scroll ok: on a wide screen the page stays still and the list and the pane each scroll in their own column "
              "(contained, the last row and card reachable, the search and the tab row put), the keyboard and an address keep the "
              "pick in the list's view, the timeline hands the wheel to the pane, and on a phone the page is the only scroller; no tab row or chip row shows a scrollbar at 1280 or 400")
    finally:
        try:
            call(base, f"/api/season/{A}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
