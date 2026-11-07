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
    assert len(soon) >= 12, soon
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
            check_empty_and_drawer(page, base, sid)
            check_add_and_contained(page)
            check_unknown_skipped(page, base, sid)
            check_save_refused(page, base, sid)
            browser.close()
        assert not errors, errors
        print("headquarters page ok: empty canvas and drawer; Coming Soon tagged; add; a broken widget contained; "
              "an unknown widget skipped; a refused save keeps the page")
    finally:
        for s in made:
            try:
                call(base, f"/api/season/{s}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
        server.terminate()
