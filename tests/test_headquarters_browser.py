"""Headquarters on the page (web/hq.js, web/hq-widgets/*.js, web/hq.css): the tab, the empty canvas with the
drawer open on first visit, the catalog (Coming Soon entries tagged, no Add), adding, a widget the page does not
know skipped, a widget that throws contained in its own card, a refused save toasting and keeping the page.
Needs Playwright with a Chromium; skipped without one. (Run as a file.)"""
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

from test_career_e2e import call, free_port, launch   # noqa: E402

BAD = ("null", "undefined", "NaN")
MIN_WIDGETS = 27      # the ready widgets (spec section 7 and Round 2)
SMALL = {"a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by", "vs"}
EMPTY_LINE = "Build your Headquarters. Add widgets for recruiting and scouting."

# a widget registered by the test before the page's own: ready, Small or Medium, one line of text
TEST_WIDGETS = """
(() => {
  let hq;
  const mine = [
    { id: "test-line", title: "Test Line", category: "recruiting", blurb: "A line for the test.", sizes: ["S", "M"], size: "S",
      sources: [], sample: {}, status: "ready", draw: () => { const p = document.createElement("p"); p.className = "test-line"; p.textContent = "Hello from the test."; return p; } },
    { id: "test-broken", title: "Test Broken", category: "scouting", blurb: "A widget that throws.", sizes: ["M"], size: "M",
      sources: [], sample: {}, status: "ready", draw: () => { throw new Error("broken on purpose"); } },
  ];
  Object.defineProperty(window, "HQ", { configurable: true,
    get() { return hq; },
    set(v) { hq = v; for (const w of mine) v.register(w); } });
})();
"""


def title_case(text: str) -> bool:
    words = [w for w in re.split(r"[\s·/→▾▶]+", text.strip()) if w]
    for i, w in enumerate(words):
        core = w.strip("'’(),.:#&-")
        if not core or not core[0].isalpha():
            continue
        if core.lower() in SMALL and 0 < i < len(words) - 1:
            continue
        if not core[0].isupper():
            return False
    return True


def open_hq(page, base, sid):
    page.goto(f"{base}/index.html?id={sid}&tab=headquarters")
    page.wait_for_selector("#season:visible", timeout=120_000)
    page.wait_for_selector("#tab-headquarters .hq-head", timeout=120_000)
    page.wait_for_function("() => !document.querySelector('#tab-headquarters .go-loading')", timeout=120_000)
    time.sleep(0.4)


def cards(page) -> list:
    return page.eval_on_selector_all("#tab-headquarters .hq-grid > .hq-card",
                                     "els => els.map(e => [e.dataset.widget, e.dataset.size])")


def clean(page, sel="#tab-headquarters") -> None:
    text = page.inner_text(sel)
    for bad in BAD:
        assert not re.search(rf"\b{bad}\b", text), f"{bad!r} on Headquarters: {text[:600]}"


def save_settled(page) -> None:
    page.wait_for_function("() => window.HQ && !window.HQ.saving()", timeout=30_000)


def add_from_drawer(page, widget: str, size: str = None) -> None:
    if not page.is_visible(".hq-drawer"):
        page.click("#tab-headquarters .hq-add-widget")
    entry = f".hq-drawer .hq-entry[data-widget='{widget}']"
    page.wait_for_selector(entry)
    if size:
        page.click(f"{entry} .hq-size[data-size='{size}']")
    page.click(f"{entry} .hq-entry-add")
    page.wait_for_selector(f"#tab-headquarters .hq-grid > .hq-card[data-widget='{widget}']")


# ----- Task 2: the canvas, the drawer, edit mode ---------------------------------------------------------

def check_empty_and_drawer(page, base, sid) -> None:
    open_hq(page, base, sid)
    assert page.inner_text("#tab-headquarters .hq-empty").strip().startswith(EMPTY_LINE)
    assert page.is_visible(".hq-drawer"), "the drawer opens by itself on an empty Headquarters"
    soon = page.eval_on_selector_all(".hq-drawer .hq-entry.soon",
                                     "els => els.map(e => [e.querySelector('.go-tag') && e.querySelector('.go-tag').textContent, !!e.querySelector('.hq-entry-add')])")
    assert len(soon) >= 1, soon            # Staff Assignments, until its mechanic is designed
    assert all(t == "Coming Soon" and not add for t, add in soon), soon
    labels = page.eval_on_selector_all(".hq-drawer .hq-entry-title, .hq-drawer .hq-cat, .hq-drawer button, #tab-headquarters .hq-head button",
                                       "els => els.filter(e => e.offsetParent).map(e => e.textContent.trim()).filter(Boolean)")
    assert labels and all(title_case(t) for t in labels), [t for t in labels if not title_case(t)]
    clean(page, ".hq-drawer")


def check_add_and_contained(page) -> None:
    add_from_drawer(page, "test-line")
    entry = ".hq-drawer .hq-entry[data-widget='test-line'] .hq-entry-add"
    assert page.inner_text(entry).strip() == "On Your Headquarters" and page.is_disabled(entry)
    add_from_drawer(page, "test-broken")
    body = page.inner_text("#tab-headquarters .hq-card[data-widget='test-broken'] .hq-body")
    assert "Couldn't Load This Widget" in body, body
    assert page.inner_text("#tab-headquarters .hq-card[data-widget='test-line'] .hq-body").strip() == "Hello from the test."
    assert not page.is_visible("#tab-headquarters .hq-empty")
    save_settled(page)


def check_unknown_skipped(page, base, sid) -> None:
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "future-thing", "size": "M"},
                                                            {"id": "c2", "widget": "test-line", "size": "S"}]})
    open_hq(page, base, sid)
    assert cards(page) == [["test-line", "S"]], cards(page)


def check_save_refused(page, base, sid) -> None:
    def refuse(route):
        if route.request.method == "POST":
            route.fulfill(status=400, content_type="application/json", body='{"error": "no"}')
        else:
            route.continue_()
    page.route("**/headquarters*", refuse)
    try:
        add_from_drawer(page, "test-broken")
        page.wait_for_function("() => [...document.querySelectorAll('.toast-item')].some(t => t.textContent.includes(\"Couldn't save your layout.\"))", timeout=15_000)
        assert ["test-broken", "M"] in cards(page), "the page keeps the card it could not save"
    finally:
        page.unroute("**/headquarters*", refuse)
        save_settled(page)


# ----- Tasks 3 and 4: every widget, live and in the drawer -------------------------------------------------

def wait_idle(base, sid) -> None:
    for _ in range(600):
        if call(base, f"/api/season/{sid}/status").get("status") != "running":
            return
        time.sleep(0.5)
    raise AssertionError("the sim did not finish")


def ready_widgets(page) -> list:
    return page.evaluate("() => HQ.widgets().filter(w => w.status !== 'soon' && !w.id.startsWith('test-')).map(w => [w.id, w.sizes, w.size])")


def check_card_clean(page, widget: str) -> None:
    sel = f"#tab-headquarters .hq-card[data-widget='{widget}']"
    page.wait_for_function("(s) => { const n = document.querySelector(s); return n && !n.querySelector('.hq-wait'); }", arg=sel, timeout=60_000)
    body = page.inner_text(f"{sel} .hq-body").strip()
    assert body, f"{widget}: an empty card"
    assert "Couldn't Load This Widget" not in body, f"{widget} failed to draw"
    for bad in BAD:
        assert not re.search(rf"\b{bad}\b", body), f"{bad!r} in {widget}: {body[:300]}"
    assert "[object" not in body.lower(), f"an object printed as text in {widget}: {body[:300]}"
    labels = page.eval_on_selector_all(f"{sel} .card-bar h3, {sel} th, {sel} .hq-body button, {sel} .go-tag, {sel} .hq-stat span, {sel} h4",
                                       "els => els.filter(e => e.offsetParent).map(e => e.textContent.trim()).filter(Boolean)")
    bad = [t for t in labels if not title_case(t)]
    assert not bad, f"{widget}: labels not in Title Case: {bad}"


def check_sweep(page, base, sid, sizes_pick) -> list:
    """Every ready widget placed at once, each at the size sizes_pick chooses; every card drawn and clean."""
    open_hq(page, base, sid)
    ws = ready_widgets(page)
    assert len(ws) >= MIN_WIDGETS, [w[0] for w in ws]
    layout = [{"id": f"c{i + 1}", "widget": w, "size": sizes_pick(sizes, size)} for i, (w, sizes, size) in enumerate(ws)]
    call(base, f"/api/season/{sid}/headquarters", {"cards": layout})
    open_hq(page, base, sid)
    for c in layout:
        check_card_clean(page, c["widget"])
    assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "sideways scroll on Headquarters"
    return ws


def check_previews(page) -> None:
    page.click("#tab-headquarters .hq-add-widget")
    page.wait_for_selector(".hq-drawer:not([hidden])")
    for wid in page.eval_on_selector_all(".hq-drawer .hq-entry:not([data-widget^='test-'])", "els => els.map(e => e.dataset.widget)"):
        entry = f".hq-drawer .hq-entry[data-widget='{wid}']"
        page.locator(entry).scroll_into_view_if_needed()
        page.wait_for_function("(s) => document.querySelector(s + ' .hq-preview').childElementCount > 0", arg=entry, timeout=10_000)
        text = page.inner_text(f"{entry} .hq-preview")
        assert "Couldn't Load This Widget" not in text, f"{wid}: its preview failed"
        for bad in BAD:
            assert not re.search(rf"\b{bad}\b", text), f"{bad!r} in the {wid} preview: {text[:300]}"
    page.click(".hq-drawer .hq-close")


def check_actions(page, base, sid, fresh) -> None:
    """Send Scout and Add to Board inside the Scouting Queue: a toast, and the card patched in place."""
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "scout-queue", "size": "M"}]})
    open_hq(page, base, sid)
    card = "#tab-headquarters .hq-card[data-widget='scout-queue']"
    check_card_clean(page, "scout-queue")
    row = page.locator(f"{card} li", has=page.locator(".hq-send-scout")).first
    name = row.locator(".go-link").inner_text().strip()
    looks0 = row.locator(".hq-looks").inner_text().strip()
    row.locator(".hq-send-scout").click()
    page.wait_for_function("(n) => [...document.querySelectorAll('.toast-item')].some(t => t.textContent.includes(n))", arg=name, timeout=30_000)
    page.wait_for_function("([c, n, was]) => { const li = [...document.querySelectorAll(c + ' li')].find(x => x.querySelector('.go-link') && x.querySelector('.go-link').textContent.trim() === n);"
                           " return li && li.querySelector('.hq-looks').textContent.trim() !== was; }", arg=[card, name, looks0], timeout=30_000)
    # Add to Board on a career with nothing on its board yet
    call(base, f"/api/season/{fresh}/headquarters", {"cards": [{"id": "c1", "widget": "scout-queue", "size": "M"}]})
    open_hq(page, base, fresh)
    check_card_clean(page, "scout-queue")
    add = page.locator(f"{card} .hq-add-board:not([disabled])").first
    add.click()
    page.wait_for_function("(c) => [...document.querySelectorAll(c + ' .hq-add-board')].some(b => b.disabled && b.textContent.trim() === 'On Board')", arg=card, timeout=30_000)


# ----- Task 5: the whole flow at 1280, the phone at 400 ------------------------------------------------------

def order(page) -> list:
    return [w for w, _ in cards(page)]


def check_flow(page, base, sid) -> None:
    """Add three, resize one, drag one, remove and Undo, Done; a reload brings the same layout back."""
    page.set_viewport_size({"width": 1280, "height": 900})
    call(base, f"/api/season/{sid}/headquarters", {"cards": []})
    open_hq(page, base, sid)
    for w in ("class-glance", "top-targets", "class-needs"):
        add_from_drawer(page, w)
    page.click(".hq-drawer .hq-close")
    assert order(page) == ["class-glance", "top-targets", "class-needs"], order(page)
    page.click("#tab-headquarters .hq-edit-toggle")
    assert page.inner_text("#tab-headquarters .hq-edit-toggle").strip() == "Done"
    page.click("#tab-headquarters .hq-card[data-widget='class-glance'] .hq-card-size[data-size='M']")
    assert ["class-glance", "M"] in cards(page), cards(page)
    for w in ("class-glance", "top-targets", "class-needs"):
        check_card_clean(page, w)
    time.sleep(0.5)                                  # the resize has repacked the grid
    page.evaluate("() => window.scrollTo(0, 0)")
    # drag Class Needs onto Class at a Glance: it lands first
    h = page.locator("#tab-headquarters .hq-card[data-widget='class-needs'] .hq-drag").bounding_box()
    t = page.locator("#tab-headquarters .hq-card[data-widget='class-glance']").bounding_box()
    page.mouse.move(h["x"] + h["width"] / 2, h["y"] + h["height"] / 2)
    page.mouse.down()
    page.mouse.move(t["x"] + 20, t["y"] + 20, steps=8)
    page.mouse.up()
    assert order(page) == ["class-needs", "class-glance", "top-targets"], order(page)
    # remove and Undo: it comes back where it was
    page.click("#tab-headquarters .hq-card[data-widget='class-glance'] .hq-remove")
    assert order(page) == ["class-needs", "top-targets"], order(page)
    page.click(".toast-item .hq-undo")
    assert order(page) == ["class-needs", "class-glance", "top-targets"], order(page)
    page.click("#tab-headquarters .hq-edit-toggle")
    assert not page.is_visible("#tab-headquarters .hq-edit"), "edit controls hide after Done"
    save_settled(page)
    want = cards(page)
    open_hq(page, base, sid)
    assert cards(page) == want, (cards(page), want)


def check_phone(page, base, sid) -> None:
    """At 400 px: one column, no drag handle, the move buttons reorder, every control 44 px tall, no sideways
    scroll, the drawer a bottom sheet."""
    page.set_viewport_size({"width": 400, "height": 860})
    open_hq(page, base, sid)
    cols = page.evaluate("() => getComputedStyle(document.querySelector('#tab-headquarters .hq-grid')).gridTemplateColumns.split(' ').length")
    assert cols == 1, cols
    page.click("#tab-headquarters .hq-edit-toggle")
    assert not page.is_visible("#tab-headquarters .hq-drag"), "no drag handle on a phone"
    before = order(page)
    page.click(f"#tab-headquarters .hq-card[data-widget='{before[0]}'] .hq-later")
    assert order(page) == [before[1], before[0], *before[2:]], order(page)
    short = page.eval_on_selector_all("#tab-headquarters button:not([disabled]), #tab-headquarters input",
                                      "els => els.filter(e => e.offsetParent).map(e => [e.textContent.trim(), e.getBoundingClientRect().height]).filter(x => x[1] < 44)")
    assert not short, f"controls under 44 px: {short}"
    assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "sideways scroll at 400 px"
    page.click("#tab-headquarters .hq-edit-toggle")
    page.click("#tab-headquarters .hq-add-widget")
    box = page.locator(".hq-drawer").bounding_box()
    assert abs(box["y"] + box["height"] - 860) <= 2 and box["width"] >= 398, box
    short = page.eval_on_selector_all(".hq-drawer button:not([disabled]), .hq-drawer input",
                                      "els => els.filter(e => e.offsetParent).map(e => [e.textContent.trim() || e.placeholder, e.getBoundingClientRect().height]).filter(x => x[1] < 44)")
    assert not short, f"drawer controls under 44 px: {short}"
    page.click(".hq-drawer .hq-close")
    save_settled(page)
    page.set_viewport_size({"width": 1280, "height": 900})


# ----- the final review's findings ----------------------------------------------------------------------------

def check_search_handlers(page, base, sid) -> None:
    """Recruit Search after Add to Board: the searched rows stay, and each row's buttons still act on that row."""
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "recruit-search", "size": "L"}]})
    open_hq(page, base, sid)
    card = "#tab-headquarters .hq-card[data-widget='recruit-search']"
    check_card_clean(page, "recruit-search")
    rows = call(base, f"/api/season/{sid}/prospects?limit=400")["rows"]
    last = next(r["name"].split()[-1] for r in rows[200:] if not r["on_board"] and len(r["name"].split()[-1]) > 4)
    page.fill(f"{card} input[type=search]", last)
    page.click(f"{card} .hq-search-row .go-btn")
    page.wait_for_function("([c, q]) => { const n = [...document.querySelectorAll(c + ' li .go-link')]; return n.length && n.every(x => x.textContent.includes(q)); }",
                           arg=[card, last], timeout=30_000)
    names = lambda: page.eval_on_selector_all(f"{card} li .go-link", "els => els.map(e => e.textContent.trim())")
    before = names()
    for i in range(min(2, len(before))):
        li = page.locator(f"{card} li").nth(i)
        name = li.locator(".go-link").inner_text().strip()
        btn = li.locator(".hq-add-board")
        if btn.is_disabled():
            continue
        btn.click()
        page.wait_for_function("(n) => [...document.querySelectorAll('.toast-item')].some(t => t.textContent.includes('Added ' + n + ' to'))", arg=name, timeout=30_000)
        time.sleep(1.0)
        assert names() == before, f"the searched rows changed after an action: {names()[:4]} vs {before[:4]}"


def check_hq_want(page, base, sid) -> None:
    """Commitment Tracker added after Hot and Cold Movers in one visit still gets its commits."""
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "movers", "size": "M"}]})
    open_hq(page, base, sid)
    check_card_clean(page, "movers")
    if page.is_visible(".hq-drawer"):
        page.click(".hq-drawer .hq-close")
    add_from_drawer(page, "commit-tracker")
    check_card_clean(page, "commit-tracker")
    assert "Total Commits" in page.inner_text("#tab-headquarters .hq-card[data-widget='commit-tracker']")
    page.click(".hq-drawer .hq-close")
    save_settled(page)


def check_drag_steady(page, base, sid) -> None:
    """A Small card dragged onto a Large one's left half, with many small moves, lands before it."""
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "program-compare", "size": "L"},
                                                            {"id": "c2", "widget": "class-glance", "size": "S"}]})
    page.set_viewport_size({"width": 1280, "height": 1400})      # both cards in view: the mouse only reaches what shows
    open_hq(page, base, sid)
    check_card_clean(page, "program-compare")
    check_card_clean(page, "class-glance")
    page.click("#tab-headquarters .hq-edit-toggle")
    page.evaluate("() => window.scrollTo(0, 0)")
    time.sleep(0.3)
    h = page.locator("#tab-headquarters .hq-card[data-widget='class-glance'] .hq-drag").bounding_box()
    t = page.locator("#tab-headquarters .hq-card[data-widget='program-compare']").bounding_box()
    page.mouse.move(h["x"] + h["width"] / 2, h["y"] + h["height"] / 2)
    page.mouse.down()
    page.mouse.move(t["x"] + 40, t["y"] + 60, steps=6)
    for dx in range(0, 30, 3):
        page.mouse.move(t["x"] + 40 + dx, t["y"] + 60 + dx)
    page.mouse.up()
    assert order(page) == ["class-glance", "program-compare"], (order(page), h, t)
    page.click("#tab-headquarters .hq-edit-toggle")
    save_settled(page)
    page.set_viewport_size({"width": 1280, "height": 900})


def check_save_flushed(page, base, sid) -> None:
    """A removal then a tab switch inside the save delay still reaches the server."""
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "class-glance", "size": "S"},
                                                            {"id": "c2", "widget": "class-needs", "size": "S"}]})
    open_hq(page, base, sid)
    page.click("#tab-headquarters .hq-edit-toggle")
    page.click("#tab-headquarters .hq-card[data-widget='class-needs'] .hq-remove")
    page.evaluate("() => document.querySelector('#season-tabs button[data-tab=recruiting]').click()")
    page.evaluate("() => document.querySelector('#season-tabs button[data-tab=headquarters]').click()")
    page.wait_for_selector("#tab-headquarters .hq-head")
    save_settled(page)
    saved = [c["widget"] for c in call(base, f"/api/season/{sid}/headquarters")["layout"]["cards"]]
    assert saved == ["class-glance"], saved


def check_no_stars(page) -> None:
    """A transfer has no star rating: no empty stars, no 'null Stars'."""
    assert page.evaluate("() => HQ.kit.stars(null) === null && HQ.kit.stars(undefined) === null"), "stars for a recruit with none"


# ----- round 2: tasks, goals and What-If ------------------------------------------------------------------------

def check_tasks_goals(page, base, sid) -> None:
    """Add a task and check it off, edit the commits goal, ask What-If: each saved, each back after a reload."""
    page.set_viewport_size({"width": 1280, "height": 900})
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "tasks", "size": "M"},
                                                            {"id": "c2", "widget": "goals", "size": "M"},
                                                            {"id": "c3", "widget": "what-if", "size": "M"}]})
    call(base, f"/api/season/{sid}/headquarters/plan", {"tasks": [], "goals": {}})
    open_hq(page, base, sid)
    for w in ("tasks", "goals", "what-if"):
        check_card_clean(page, w)
    tasks = "#tab-headquarters .hq-card[data-widget='tasks']"
    page.fill(f"{tasks} .hq-task-input", "Call the top corner.")
    page.press(f"{tasks} .hq-task-input", "Enter")
    page.wait_for_selector(f"{tasks} li.hq-task:has-text('Call the top corner.')")
    page.click(f"{tasks} li.hq-task:has-text('Call the top corner.') .hq-task-done")
    for _ in range(60):
        saved = call(base, f"/api/season/{sid}/headquarters?want=tasks")["tasks"]
        if saved and saved[0]["done"]:
            break
        time.sleep(0.25)
    assert saved == [{"id": saved[0]["id"], "text": "Call the top corner.", "done": True}], saved
    goals = "#tab-headquarters .hq-card[data-widget='goals']"
    page.click(f"{goals} .hq-goal[data-goal='commits'] .hq-goal-edit")
    page.fill(f"{goals} .hq-goal[data-goal='commits'] .hq-goal-input", "12")
    page.press(f"{goals} .hq-goal[data-goal='commits'] .hq-goal-input", "Enter")
    for _ in range(60):
        g = {x["id"]: x for x in call(base, f"/api/season/{sid}/headquarters?want=goals")["goals"]}
        if g["commits"]["target"] == 12:
            break
        time.sleep(0.25)
    assert g["commits"]["target"] == 12, g["commits"]
    wif = "#tab-headquarters .hq-card[data-widget='what-if']"
    opts = page.eval_on_selector_all(f"{wif} select option", "os => os.map(o => o.value).filter(Boolean)")
    if opts:
        page.select_option(f"{wif} select", opts[0])
        page.wait_for_selector(f"{wif} .hq-whatif-result", timeout=30_000)
        text = page.inner_text(f"{wif} .hq-whatif-result")
        assert "If He Commits" in text and not re.search(r"\b(null|undefined|NaN)\b", text), text
    open_hq(page, base, sid)
    check_card_clean(page, "tasks")
    assert page.is_checked(f"{tasks} li.hq-task:has-text('Call the top corner.') .hq-task-done")
    assert "12" in page.inner_text(f"{goals} .hq-goal[data-goal='commits']")
    save_settled(page)


def check_scrolls(page, base, sid) -> None:
    """Every card keeps its height; a long widget scrolls inside its own body, and the page does not move."""
    page.set_viewport_size({"width": 1280, "height": 900})
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "recruit-search", "size": "M"},
                                                            {"id": "c2", "widget": "calendar", "size": "M"},
                                                            {"id": "c3", "widget": "class-glance", "size": "S"}]})
    open_hq(page, base, sid)
    for w in ("recruit-search", "calendar", "class-glance"):
        check_card_clean(page, w)
    h = dict(page.eval_on_selector_all("#tab-headquarters .hq-card", "els => els.map(e => [e.dataset.widget, Math.round(e.getBoundingClientRect().height)])"))
    assert max(h.values()) <= 460, f"no card taller than its cap: {h}"
    assert h["class-glance"] <= 220, f"a short widget's card fits its content, no empty box: {h}"
    sr = "#tab-headquarters .hq-card[data-widget='recruit-search']"
    top = page.eval_on_selector(f"{sr} .hq-body", "b => Math.round(b.querySelector('.hq-list li').getBoundingClientRect().top - b.getBoundingClientRect().top)")
    assert top <= 70, f"Recruit Search: its controls take one compact row, the results start right under: {top}px"
    body = "#tab-headquarters .hq-card[data-widget='recruit-search'] .hq-body"
    info = page.eval_on_selector(body, "b => ({over: getComputedStyle(b).overflowY, sh: b.scrollHeight, ch: b.clientHeight})")
    assert info["over"] == "auto" and info["sh"] > info["ch"], f"a long widget scrolls in its body: {info}"
    y0 = page.evaluate("() => window.scrollY")
    page.eval_on_selector(body, "b => { b.scrollTop = 200; }")
    assert page.eval_on_selector(body, "b => b.scrollTop") > 0 and page.evaluate("() => window.scrollY") == y0
    bars = page.eval_on_selector_all("#tab-headquarters .hq-card .hq-bar", "els => els.map(e => Math.round(e.getBoundingClientRect().height))")
    assert max(bars) <= 34, f"thin card headers on a wide screen, the room goes to the content: {bars}"
    rows = page.eval_on_selector_all(f"{body} li", "els => els.length")
    assert rows > 8, f"a scrolling widget shows more than one screen of rows: {rows}"
    page.set_viewport_size({"width": 400, "height": 860})
    open_hq(page, base, sid)
    hs = page.eval_on_selector_all("#tab-headquarters .hq-card", "els => els.map(e => Math.round(e.getBoundingClientRect().height))")
    assert max(hs) <= 480, f"cards keep a fixed height on a phone too: {hs}"
    page.set_viewport_size({"width": 1280, "height": 900})


def check_masonry(page, base, sid) -> None:
    """Cards pack like masonry: the same gap everywhere, no overlap, and a short card stacks under another short card
    beside a tall one instead of waiting for the row to end."""
    page.set_viewport_size({"width": 1440, "height": 900})
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "position-battles", "size": "M"},
                                                            {"id": "c2", "widget": "class-glance", "size": "S"},
                                                            {"id": "c3", "widget": "resources", "size": "S"},
                                                            {"id": "c4", "widget": "scholarships", "size": "S"},
                                                            {"id": "c5", "widget": "flags", "size": "S"}]})
    open_hq(page, base, sid)
    for w in ("position-battles", "class-glance", "resources", "scholarships", "flags"):
        check_card_clean(page, w)
    time.sleep(0.5)
    r = dict(page.eval_on_selector_all("#tab-headquarters .hq-card", "els => els.map(e => { const b = e.getBoundingClientRect(); return [e.dataset.widget, [b.left, b.top, b.right, b.bottom]]; })"))
    names = list(r)
    for i, a in enumerate(names):                    # no two cards overlap
        for b in names[i + 1:]:
            A, B = r[a], r[b]
            assert A[2] <= B[0] + 1 or B[2] <= A[0] + 1 or A[3] <= B[1] + 1 or B[3] <= A[1] + 1, f"{a} overlaps {b}: {A} {B}"
    tall, under = r["position-battles"], r["scholarships"]
    above = r["class-glance"] if abs(r["class-glance"][0] - under[0]) < 2 else r["resources"]
    assert abs(above[0] - under[0]) < 2, f"Scholarship Budget stacks under a short card: {r}"
    gap = under[1] - above[3]
    assert 10 <= gap <= 22, f"the gap under a card is the grid's gap, not the end of a row: {gap}px {r}"
    assert under[1] < tall[3], f"it sits beside the tall card, not below it: {r}"
    # the window narrows to a phone with the page open: one column, nothing overlapping
    page.set_viewport_size({"width": 400, "height": 900})
    time.sleep(0.6)
    r = page.eval_on_selector_all("#tab-headquarters .hq-card", "els => els.map(e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; })")
    assert len({round(x[0]) for x in r}) == 1, f"one column after narrowing the window: {r}"
    for i, A in enumerate(r):
        for B in r[i + 1:]:
            assert A[3] <= B[1] + 1 or B[3] <= A[1] + 1, f"cards overlap after narrowing the window: {r}"
    page.set_viewport_size({"width": 1440, "height": 900})


def check_drag_live(page, base, sid) -> None:
    """While dragging, the card follows the pointer and a placeholder shows where it will land, the other cards making
    room as you go; the drop puts it there; Escape puts it back."""
    page.set_viewport_size({"width": 1440, "height": 1400})
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "class-glance", "size": "S"},
                                                            {"id": "c2", "widget": "resources", "size": "S"},
                                                            {"id": "c3", "widget": "scholarships", "size": "S"},
                                                            {"id": "c4", "widget": "flags", "size": "S"}]})
    open_hq(page, base, sid)
    for w in ("class-glance", "resources", "scholarships", "flags"):
        check_card_clean(page, w)
    page.click("#tab-headquarters .hq-edit-toggle")
    time.sleep(0.4)
    box = lambda w: page.locator(f"#tab-headquarters .hq-card[data-widget='{w}']").bounding_box()
    h = page.locator("#tab-headquarters .hq-card[data-widget='flags'] .hq-drag").bounding_box()
    t = box("class-glance")
    page.mouse.move(h["x"] + h["width"] / 2, h["y"] + h["height"] / 2)
    page.mouse.down()
    px, py = t["x"] + 30, t["y"] + 40
    page.mouse.move(px, py, steps=10)
    time.sleep(0.3)
    assert page.is_visible("#tab-headquarters .hq-placeholder"), "a placeholder shows where the card will land"
    f = box("flags")
    assert f["x"] - 60 <= px <= f["x"] + f["width"] + 60 and f["y"] - 60 <= py <= f["y"] + f["height"] + 60, f"the card follows the pointer: {f} vs {(px, py)}"
    slots = page.eval_on_selector_all("#tab-headquarters .hq-grid > *", "els => els.map(e => e.classList.contains('hq-placeholder') ? 'PLACE' : e.dataset.widget)")
    assert slots.index("PLACE") < slots.index("class-glance"), f"the placeholder moved ahead of the card under the pointer: {slots}"
    ph = page.locator("#tab-headquarters .hq-placeholder").bounding_box()
    assert abs(ph["x"] - t["x"]) < 4, f"the others made room: the placeholder took the first slot {ph} {t}"
    page.mouse.up()
    time.sleep(0.4)
    assert not page.is_visible("#tab-headquarters .hq-placeholder")
    assert order(page)[0] == "flags", order(page)
    # Escape mid-drag puts the card back where it was
    before = order(page)
    h = page.locator("#tab-headquarters .hq-card[data-widget='flags'] .hq-drag").bounding_box()
    t = box("scholarships")
    page.mouse.move(h["x"] + h["width"] / 2, h["y"] + h["height"] / 2)
    page.mouse.down()
    page.mouse.move(t["x"] + t["width"] - 20, t["y"] + 40, steps=10)
    page.keyboard.press("Escape")
    page.mouse.up()
    time.sleep(0.4)
    assert order(page) == before and not page.is_visible("#tab-headquarters .hq-placeholder"), (order(page), before)
    page.click("#tab-headquarters .hq-edit-toggle")
    save_settled(page)
    page.set_viewport_size({"width": 1280, "height": 900})


def check_resize(page, base, sid) -> None:
    """Heights: Auto by default; in Edit Layout, drag a card's bottom edge to set its height (snapped, the grid
    making room), double-click the edge for Auto again; on a phone, the Auto, Tall and Extra Tall chips."""
    page.set_viewport_size({"width": 1440, "height": 1400})
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "scout-queue", "size": "M"},
                                                            {"id": "c2", "widget": "class-glance", "size": "S"},
                                                            {"id": "c3", "widget": "resources", "size": "S"}]})
    open_hq(page, base, sid)
    for w in ("scout-queue", "class-glance", "resources"):
        check_card_clean(page, w)
    card = "#tab-headquarters .hq-card[data-widget='scout-queue']"
    page.click("#tab-headquarters .hq-edit-toggle")
    time.sleep(0.4)
    h0 = page.locator(card).bounding_box()["height"]
    r = page.locator(f"{card} .hq-resize").bounding_box()
    page.mouse.move(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
    page.mouse.down()
    page.mouse.move(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2 + 300, steps=10)
    page.mouse.up()
    time.sleep(0.4)
    h1 = page.locator(card).bounding_box()["height"]
    assert h1 >= h0 + 250 and abs(h1 - (h0 + 300)) <= 40, f"the edge drag sets the height, snapped: {h0} -> {h1}"
    boxes = page.eval_on_selector_all("#tab-headquarters .hq-card", "els => els.map(e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; })")
    for i, a in enumerate(boxes):
        for b in boxes[i + 1:]:
            assert a[2] <= b[0] + 1 or b[2] <= a[0] + 1 or a[3] <= b[1] + 1 or b[3] <= a[1] + 1, f"cards overlap after a resize: {boxes}"
    save_settled(page)
    saved = {c["widget"]: c for c in call(base, f"/api/season/{sid}/headquarters")["layout"]["cards"]}
    assert abs(saved["scout-queue"].get("h", 0) - h1) <= 1, saved
    open_hq(page, base, sid)
    check_card_clean(page, "scout-queue")
    assert abs(page.locator(card).bounding_box()["height"] - h1) <= 1, "the height comes back after a reload"
    page.click("#tab-headquarters .hq-edit-toggle")
    page.dblclick(f"{card} .hq-resize")
    time.sleep(0.4)
    assert page.locator(card).bounding_box()["height"] <= 410, "a double-click on the edge goes back to Auto"
    save_settled(page)
    assert "h" not in {c["widget"]: c for c in call(base, f"/api/season/{sid}/headquarters")["layout"]["cards"]}["scout-queue"]
    # a phone: chips, no edge
    page.set_viewport_size({"width": 400, "height": 860})
    open_hq(page, base, sid)
    check_card_clean(page, "scout-queue")
    page.click("#tab-headquarters .hq-edit-toggle")
    assert not page.is_visible(f"{card} .hq-resize"), "no edge to drag on a phone"
    page.click(f"{card} .hq-height[data-h='560']")
    time.sleep(0.4)
    assert abs(page.locator(card).bounding_box()["height"] - 560) <= 2, page.locator(card).bounding_box()
    page.click(f"{card} .hq-height[data-h='']")
    time.sleep(0.4)
    assert page.locator(card).bounding_box()["height"] <= 430
    page.click("#tab-headquarters .hq-edit-toggle")
    save_settled(page)
    page.set_viewport_size({"width": 1280, "height": 900})


def check_edit_overlay(page, base, sid) -> None:
    """Edit Layout lays its controls over each card on a see-through layer: no card changes size."""
    page.set_viewport_size({"width": 1440, "height": 1000})
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "class-glance", "size": "M"},
                                                            {"id": "c2", "widget": "flags", "size": "S"},
                                                            {"id": "c3", "widget": "top-targets", "size": "M"}]})
    open_hq(page, base, sid)
    for w in ("class-glance", "flags", "top-targets"):
        check_card_clean(page, w)
    time.sleep(0.3)
    sizes = lambda: page.eval_on_selector_all("#tab-headquarters .hq-card", "els => els.map(e => { const b = e.getBoundingClientRect(); return [e.dataset.widget, Math.round(b.width), Math.round(b.height), Math.round(b.top)]; })")
    before = sizes()
    page.click("#tab-headquarters .hq-edit-toggle")
    time.sleep(0.4)
    assert sizes() == before, f"no card changes size or place in Edit Layout: {before} vs {sizes()}"
    over = page.eval_on_selector("#tab-headquarters .hq-card[data-widget='class-glance'] .hq-edit",
                                 "e => ({pos: getComputedStyle(e).position, shown: !!e.offsetParent, bg: getComputedStyle(e).backgroundColor})")
    assert over["pos"] == "absolute" and over["shown"], over
    assert "rgba" in over["bg"] or "color(" in over["bg"], f"the layer is see-through: {over}"
    page.click("#tab-headquarters .hq-edit-toggle")
    time.sleep(0.3)
    assert sizes() == before
    page.set_viewport_size({"width": 1280, "height": 900})


def check_resize_snap(page, base, sid) -> None:
    """Resizing snaps a card's bottom to a neighbor's bottom when it comes close, with a guide line; dragging on past
    lets go. Nothing is forced."""
    page.set_viewport_size({"width": 1440, "height": 1200})
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "top-targets", "size": "M"},
                                                            {"id": "c2", "widget": "scout-queue", "size": "M"}]})
    open_hq(page, base, sid)
    for w in ("top-targets", "scout-queue"):
        check_card_clean(page, w)
    page.click("#tab-headquarters .hq-edit-toggle")
    time.sleep(0.4)
    box = lambda w: page.locator(f"#tab-headquarters .hq-card[data-widget='{w}']").bounding_box()
    tt, sq = box("top-targets"), box("scout-queue")
    target = tt["y"] + tt["height"]
    assert abs((sq["y"] + sq["height"]) - target) > 30, f"the test needs two different heights: {tt} {sq}"
    r = page.locator("#tab-headquarters .hq-card[data-widget='scout-queue'] .hq-resize").bounding_box()
    x, y0 = r["x"] + r["width"] / 2, r["y"] + r["height"] / 2
    bottom0 = sq["y"] + sq["height"]                  # mouse y = y0 + (the bottom wanted - where the drag began)
    page.mouse.move(x, y0)
    page.mouse.down()
    page.mouse.move(x, y0 + (target + 7 - bottom0), steps=8)
    time.sleep(0.2)
    sq = box("scout-queue")
    assert abs(sq["y"] + sq["height"] - target) <= 1, f"close to the neighbor's bottom, it snaps to it: {sq['y'] + sq['height']} vs {target}"
    assert page.is_visible("#tab-headquarters .hq-guide"), "a guide line shows the alignment"
    page.mouse.move(x, y0 + (target + 70 - bottom0), steps=4)
    time.sleep(0.2)
    sq = box("scout-queue")
    assert abs(sq["y"] + sq["height"] - target) > 30 and not page.is_visible("#tab-headquarters .hq-guide"), "dragged on past, it lets go"
    page.mouse.move(x, y0 + (target + 5 - bottom0), steps=4)
    page.mouse.up()
    time.sleep(0.3)
    sq = box("scout-queue")
    assert abs(sq["y"] + sq["height"] - target) <= 1 and not page.is_visible("#tab-headquarters .hq-guide")
    page.click("#tab-headquarters .hq-edit-toggle")
    save_settled(page)
    saved = {c["widget"]: c for c in call(base, f"/api/season/{sid}/headquarters")["layout"]["cards"]}
    assert abs(saved["scout-queue"]["h"] - round(sq["height"])) <= 1, saved
    # a neighbor only a few pixels off: the snap still sticks when you let go
    tt_h = round(page.locator("#tab-headquarters .hq-card[data-widget='top-targets']").bounding_box()["height"])
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "top-targets", "size": "M"},
                                                            {"id": "c2", "widget": "scout-queue", "size": "M", "h": tt_h + 8}]})
    open_hq(page, base, sid)
    for w in ("top-targets", "scout-queue"):
        check_card_clean(page, w)
    page.click("#tab-headquarters .hq-edit-toggle")
    time.sleep(0.4)
    tt, sq = box("top-targets"), box("scout-queue")
    target, bottom0 = tt["y"] + tt["height"], sq["y"] + sq["height"]
    r = page.locator("#tab-headquarters .hq-card[data-widget='scout-queue'] .hq-resize").bounding_box()
    x, y0 = r["x"] + r["width"] / 2, r["y"] + r["height"] / 2
    page.mouse.move(x, y0)
    page.mouse.down()
    page.mouse.move(x, y0 + (target - 2 - bottom0), steps=4)
    page.mouse.up()
    time.sleep(0.3)
    sq = box("scout-queue")
    assert abs(sq["y"] + sq["height"] - target) <= 1, f"a small snap sticks after the drop: {sq['y'] + sq['height']} vs {target}"
    page.click("#tab-headquarters .hq-edit-toggle")
    save_settled(page)
    page.set_viewport_size({"width": 1280, "height": 900})


def check_bar_gaps(page, base, sid) -> None:
    """Room between every card's header and its content; thin headers on the Recruiting and Scouting tabs too."""
    page.set_viewport_size({"width": 1440, "height": 1000})
    call(base, f"/api/season/{sid}/headquarters", {"cards": [{"id": "c1", "widget": "tasks", "size": "M"},
                                                            {"id": "c2", "widget": "movers", "size": "M"},
                                                            {"id": "c3", "widget": "senior-impact", "size": "L"}]})
    open_hq(page, base, sid)
    for w in ("tasks", "movers", "senior-impact"):
        check_card_clean(page, w)
    gaps = page.eval_on_selector_all("#tab-headquarters .hq-card", """els => els.map(e => {
      const bar = e.querySelector('.hq-bar').getBoundingClientRect();
      const first = e.querySelector('.hq-body').firstElementChild;
      const inner = first.firstElementChild || first;
      return [e.dataset.widget, Math.round(Math.min(first.getBoundingClientRect().top, inner.getBoundingClientRect().top) - bar.bottom)];
    })""")
    assert all(g >= 10 for _, g in gaps), f"room under every header: {gaps}"
    for tab, wait in (("recruiting", ".go-row-recruit, .go-board, .card-bar"), ("scouting", ".sc-list, .card-bar")):
        page.goto(f"{base}/index.html?id={sid}&tab={tab}")
        page.wait_for_selector(f"#tab-{tab} .card-bar", timeout=120_000)
        time.sleep(0.6)
        # every bar no taller than its tallest child needs: 34 px for a title, the control's own height plus a little for a bar holding one
        bars = page.eval_on_selector_all(f"#tab-{tab} .card-bar", """els => els.filter(e => e.offsetParent).map(e => [Math.round(e.getBoundingClientRect().height),
          Math.max(0, ...[...e.querySelectorAll('*')].map(k => Math.round(k.getBoundingClientRect().height)))])""")
        assert bars, f"no bars on the {tab} tab"
        fat = [b for b in bars if b[0] > max(34, b[1] + 4)]
        assert not fat, f"thin headers on the {tab} tab (height, tallest child): {fat}"
    page.set_viewport_size({"width": 1280, "height": 900})


def live_career(base) -> str:
    """A career three weeks in with a board: the widgets have real data to draw."""
    sid = call(base, "/api/season", {"team": "georgia", "seed": 7})["id"]
    rows = call(base, f"/api/season/{sid}/prospects?limit=40")["rows"]
    for r in rows[:15]:
        call(base, f"/api/season/{sid}/board", {"pid": r["id"], "on": True})
    call(base, f"/api/season/{sid}/settings", {"auto_recruit": "season"})
    call(base, f"/api/season/{sid}/advance", {"to": 3})
    wait_idle(base, sid)
    return sid


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("headquarters page test skipped: Playwright is not installed")
        raise SystemExit(0)
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    made = []
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(base + "/api/teams", timeout=2)
                break
            except OSError:
                time.sleep(0.5)
        sid = call(base, "/api/season", {"team": "texas", "seed": 5})["id"]
        made.append(sid)
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"headquarters page test skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.add_init_script(TEST_WIDGETS)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.dismiss())
            only_review = os.environ.get("HQ_REVIEW_ONLY") == "1"      # a quicker loop over the final review's checks alone
            if not only_review:
                check_empty_and_drawer(page, base, sid)
                check_add_and_contained(page)
                check_unknown_skipped(page, base, sid)
                check_save_refused(page, base, sid)
            live = live_career(base)
            made.append(live)
            if only_review:
                for f in (check_bar_gaps, check_resize_snap, check_edit_overlay, check_resize, check_drag_live, check_masonry, check_scrolls, check_search_handlers, check_hq_want, check_drag_steady, check_save_flushed):
                    try:
                        f(page, base, live)
                        print("  pass", f.__name__)
                    except AssertionError as e:
                        print("  FAIL", f.__name__, str(e)[:160])
                try:
                    check_no_stars(page)
                    print("  pass check_no_stars")
                except AssertionError as e:
                    print("  FAIL check_no_stars", e)
                page.set_viewport_size({"width": 400, "height": 860})
                open_hq(page, base, live)
                short = page.eval_on_selector_all("#tab-headquarters button:not([disabled]), #tab-headquarters input",
                                                  "els => els.filter(e => e.offsetParent).map(e => [e.textContent.trim() || e.placeholder, Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 44)")
                print("  phone controls under 44 px:", short[:6])
                raise SystemExit(0)
            check_sweep(page, base, live, lambda sizes, size: size)
            check_sweep(page, base, live, lambda sizes, size: sizes[-1])
            check_sweep(page, base, sid, lambda sizes, size: sizes[0])      # a new career: nothing on the board yet
            check_previews(page)
            check_actions(page, base, live, sid)
            check_flow(page, base, live)
            check_phone(page, base, live)
            check_search_handlers(page, base, live)
            check_hq_want(page, base, live)
            check_drag_steady(page, base, live)
            check_save_flushed(page, base, live)
            check_no_stars(page)
            check_tasks_goals(page, base, live)
            check_scrolls(page, base, live)
            check_masonry(page, base, live)
            check_drag_live(page, base, live)
            check_resize(page, base, live)
            check_edit_overlay(page, base, live)
            check_resize_snap(page, base, live)
            check_bar_gaps(page, base, live)
            browser.close()
        assert not errors, errors
        print("headquarters page ok: empty canvas and drawer; Coming Soon tagged; add; a broken widget contained; "
              "an unknown widget skipped; a refused save keeps the page; every widget live at every size and in the drawer; "
              "Send Scout and Add to Board in place; add, resize, drag, remove and Undo, reload; the phone layout; tasks, goals and What-If; cards scroll inside; masonry packing; a live drag; heights by the edge and by chips; edit controls over the cards; heights snap to neighbors; room under headers, thin headers on Recruiting and Scouting")
    finally:
        for s in made:
            try:
                call(base, f"/api/season/{s}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
        server.terminate()
