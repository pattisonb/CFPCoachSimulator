"""The Prospects tab's + Board button (web/recruiting.js renderProspects) in a browser at 1280 and 400 px, for a high
school prospect in the regular recruiting season and for an entrant in the transfer portal (a finished career taken to
the portal's first week, as in test_portal_recap_e2e.py). The player's bug: after the list had been patched in place
(a filter, a page, a sort), + Board put him on the board but the button stayed + Board, because the handler a morph
moved onto the row on screen patched the freshly drawn button that never reached the page. So each check first patches
the list in place (a Position filter that keeps the row: the same <tr> stays on screen), then clicks + Board: the live
button reads ✓ On Board (aria-pressed true, the On Board count up one), the API's board holds him, a refresh keeps him
there, and a click on ✓ On Board takes him off again (+ Board, gone from the API's board). No page error, no console
error. Needs Playwright with a Chromium; skipped without one. (Run as a file.)"""
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
from test_ux_sweep import open_tab, toasted   # noqa: E402

ROWS = "#tab-prospects .pr-table tbody tr.pr-row"


def settled(page) -> None:
    page.wait_for_function("() => { const m = document.querySelector('#tab-prospects .pr-main'); "
                           f"return m && !m.hasAttribute('aria-busy') && document.querySelectorAll(\"{ROWS}\").length > 0; }}", timeout=60_000)


def on_board(base, sid) -> set:
    return {b["id"] for b in call(base, f"/api/season/{sid}/recruiting")["board"]}


def button(page, pid) -> dict:
    return page.eval_on_selector(f"{ROWS}[data-key='{pid}'] .pr-board",
                                 "e => ({ text: e.textContent, pressed: e.getAttribute('aria-pressed'), on: e.classList.contains('on'), "
                                 "mark: e.closest('tr').dataset.mark || null, disabled: e.disabled })")


def board_count(page) -> int:
    return int(page.inner_text("#tab-prospects .pr-fp-stat[data-key=board] b").replace(",", ""))


def wait_text(page, pid, text) -> None:
    page.wait_for_function("([id, t]) => { const b = document.querySelector(`tr.pr-row[data-key='${id}'] .pr-board`); return b && b.textContent === t && !b.disabled; }",
                           arg=[pid, text], timeout=30_000)


def check(page, base, sid, portal: bool, width: int, errors) -> str:
    page.set_viewport_size({"width": width, "height": 1000 if width > 600 else 860})
    open_tab(page, base, sid, "prospects", ROWS)
    settled(page)
    rows = call(base, f"/api/season/{sid}/prospects?limit=50")["rows"]
    assert rows and all(bool(r.get("portal")) == portal for r in rows), f"{'portal entrants' if portal else 'high school prospects'} in the list"
    r = next(x for x in rows if not x["on_board"] and not x["offered"] and not x.get("signed") and not x.get("committed"))
    pid, name = r["id"], r["name"]
    assert button(page, pid)["text"] == "+ Board"
    # the list patched in place first: the row on screen is kept and handed the freshly drawn row's handlers
    page.eval_on_selector(f"{ROWS}[data-key='{pid}']", "e => { e.dataset.mark = 'live'; }")
    page.select_option("#tab-prospects select[aria-label=Position]", r["position"])
    page.wait_for_function("(pos) => [...document.querySelectorAll('#tab-prospects .pr-table tbody tr.pr-row .pr-c-pos b')].length > 0 "
                           "&& !document.querySelector('#tab-prospects .pr-main').hasAttribute('aria-busy') "
                           "&& new URL(location.href).searchParams.get('ppos') === pos", arg=r["position"], timeout=30_000)
    settled(page)
    assert button(page, pid)["mark"] == "live", "the filter patched his row in place (the same <tr>)"
    before = board_count(page)

    # + Board: the live button flips, the count follows, the API's board holds him
    page.click(f"{ROWS}[data-key='{pid}'] .pr-board")
    toasted(page, f"{name} is on your board.")
    wait_text(page, pid, "✓ On Board")
    b = button(page, pid)
    assert b == {"text": "✓ On Board", "pressed": "true", "on": True, "mark": "live", "disabled": False}, b
    page.wait_for_function("(n) => Number(document.querySelector('#tab-prospects .pr-fp-stat[data-key=board] b').textContent.replace(/,/g, '')) === n",
                           arg=before + 1, timeout=10_000)
    assert pid in on_board(base, sid), "the API's board holds him"

    # a refresh keeps him there
    page.reload()
    page.wait_for_selector(ROWS, timeout=120_000)
    settled(page)
    wait_text(page, pid, "✓ On Board")
    page.eval_on_selector(f"{ROWS}[data-key='{pid}']", "e => { e.dataset.mark = 'live'; }")

    # ✓ On Board: off again, in place
    page.click(f"{ROWS}[data-key='{pid}'] .pr-board")
    toasted(page, f"{name} is off your board.")
    wait_text(page, pid, "+ Board")
    b = button(page, pid)
    assert b == {"text": "+ Board", "pressed": "false", "on": False, "mark": "live", "disabled": False}, b
    assert pid not in on_board(base, sid), "the API's board let him go"
    page.select_option("#tab-prospects select[aria-label=Position]", "")
    settled(page)
    assert not errors, errors
    return name


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("prospects board button skipped: Playwright is not installed")
        raise SystemExit(0)
    from sim import season
    from test_offseason import finished
    hs = season.new_season("smu", "full", seed=71, career=True)
    season.save_season(hs)
    pt = season.new_season("ohio-state", "full", seed=11, career=True)
    finished(pt)
    season.save_season(pt)
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
        v = call(base, f"/api/season/{pt['id']}/offseason")
        while v["stage"] != "portal_w1":
            v = call(base, f"/api/season/{pt['id']}/offseason/advance", {})
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"prospects board button skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            # the dev server has no version.json (the page then calls the server directly): its 404 is the only console error allowed
            page.on("console", lambda m: errors.append(f"{m.text} ({m.location.get('url')})")
                    if m.type == "error" and not str(m.location.get("url", "")).endswith("/version.json") else None)
            page.on("dialog", lambda d: d.accept())
            done = []
            for width in (1280, 400):
                done.append(f"{width}: {check(page, base, hs['id'], False, width, errors)} (class), {check(page, base, pt['id'], True, width, errors)} (portal)")
            browser.close()
        print(f"prospects board button ok: + Board flips to ✓ On Board in place after the list was patched, the API's board holds him, "
              f"a refresh keeps him, ✓ On Board takes him off; no console error ({'; '.join(done)})")
    finally:
        for sid in (hs["id"], pt["id"]):
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
        server.terminate()
