"""The Official Visit picker: in the Recruit menu, Official Visit opens a second step listing your home
weekends left ("Wk 6 · vs #4 USC"), the first free one marked First Free Weekend and a weekend he has at
another school grayed with that school's name; picking a later one books it (the pane's pill reads
"Visit Wk N" for that week, his History shows the invite). Needs Playwright with a Chromium; skipped
without one. `python3 tests/test_visit_picker.py`"""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch   # noqa: E402
from test_scene_window import open_board, pick_row, wait_server   # noqa: E402

ME = "ohio-state"
SHOTS = Path(os.environ.get("VISIT_PICKER_SHOTS", "")) if os.environ.get("VISIT_PICKER_SHOTS") else None


def make_career():
    """A fresh career: a recruit you offered who has you in his top group leads your board, with another
    school holding your first home weekend for him."""
    from coach_career import recruiting
    from sim import season
    st = season.new_season(ME, "full", seed=11, career=True)
    rc = st["recruiting"]
    rc["hours"][ME] = 200
    homes = sorted(g["week"] for g in st["games"].values() if g["home"] == ME and g["kind"] == "regular" and g["week"] > st["current_week"])
    assert len(homes) >= 3, homes
    pid = None
    for q in recruiting.prospect_list(st):
        if rc["prospects"][q].get("hidden") or rc["status"][q]["committed"] or recruiting.would_pester(st, ME, q):
            continue
        recruiting.act(st, ME, q, "offer", recruiting.PITCHES[0], 0)
        if recruiting.stage(st, ME, q) == "top" and not recruiting.cooled(st, ME, q):   # a lowball cools him: no visit then
            pid = q
            break
        recruiting.act(st, ME, q, "pull_offer")
    assert pid, "no recruit put us in his top group"
    rc["visits"][pid] = {"michigan": {"week": homes[0], "done": False}}
    rc["board"] = [pid] + [q for q in rc["board"] if q != pid]
    season.save_season(st)
    return st["id"], pid, homes


def open_picker(page):
    page.click(".go-pane #rc-recruit")
    page.wait_for_selector(".go-menu[role=menu] .go-menu-item[data-action=official_visit]")
    page.click(".go-menu .go-menu-item[data-action=official_visit]")
    page.wait_for_selector(".go-menu .go-menu-item[data-action=visit_week]")
    time.sleep(0.3)
    return page.eval_on_selector_all(".go-menu .go-menu-item", """els => els.map((e) => ({ action: e.dataset.action, week: e.dataset.week ? Number(e.dataset.week) : null,
        name: e.querySelector('b').textContent, cost: (e.querySelector('.go-menu-cost') || {}).textContent || '',
        disabled: e.getAttribute('aria-disabled') === 'true', why: (e.querySelector('.go-menu-why') || {}).textContent || '',
        height: e.getBoundingClientRect().height }))""")


def check(page, pid, homes, width):
    pick_row(page, pid)
    rows = open_picker(page)
    assert rows[0]["action"] == "back", rows[0]
    weeks = [r for r in rows if r["action"] == "visit_week"]
    assert [r["week"] for r in weeks] == homes, (weeks, homes)
    assert all(r["name"].startswith(f"Wk {r['week']} · vs ") for r in weeks), weeks
    assert weeks[0]["disabled"] and weeks[0]["why"] == "He's at Michigan that weekend", weeks[0]
    assert weeks[1]["cost"] == "First Free Weekend" and not weeks[1]["disabled"], weeks[1]
    assert all(r["cost"] != "First Free Weekend" for r in weeks[2:]), weeks
    assert all(r["height"] >= (44 if width < 700 else 40) for r in rows), [r["height"] for r in rows]
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"picker-{width}.png"))
    # Back returns to the actions; Escape closes
    page.click(".go-menu .go-menu-item[data-action=back]")
    page.wait_for_selector(".go-menu .go-menu-item[data-action=message]")
    page.keyboard.press("Escape")
    page.wait_for_selector(".go-menu", state="detached")


def book(page, pid, homes):
    rows = open_picker(page)
    target = homes[2]                                        # the second free weekend
    draw = page.evaluate("() => +(document.querySelector('.rc-head').parentElement.dataset.draw || 0)")
    page.click(f".go-menu .go-menu-item[data-action=visit_week][data-week='{target}']")
    page.wait_for_function("(n) => +(document.querySelector('.rc-head').parentElement.dataset.draw || 0) > n", arg=draw, timeout=30_000)
    time.sleep(0.5)
    pill = page.eval_on_selector_all(".go-pane [data-key=visit]", "els => els.map(e => (e.querySelector('.go-tag') || e).textContent)")   # the pill, in its tip wrapper when it has one
    assert pill == [f"Visit Wk {target}"], (pill, target)
    page.click(".go-pane [data-sub=history]")
    page.wait_for_selector(".go-pane .pv-tl-row", timeout=10_000)
    lines = page.eval_on_selector_all(".go-pane .pv-tl-row", "els => els.map(e => e.dataset.line)")
    assert any("Official Visit" in ln for ln in lines), lines
    return rows


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("visit picker skipped: Playwright is not installed")
        raise SystemExit(0)
    sid, pid, homes = make_career()
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_server(base)
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"visit picker skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            errs = []
            # the phone: the picker as the bottom sheet, every row at least 44 px
            page = browser.new_page(viewport={"width": 400, "height": 800})
            page.on("pageerror", lambda e: errs.append(str(e)))
            open_board(page, base, sid)
            check(page, pid, homes, 400)
            page.close()
            # the desk: the picker under the Recruit button, then the booking
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.on("pageerror", lambda e: errs.append(str(e)))
            open_board(page, base, sid)
            check(page, pid, homes, 1280)
            book(page, pid, homes)
            browser.close()
            assert not errs, errs
        print(f"visit picker ok: the home weekends listed with the first free marked, the taken one named, week {homes[2]} booked from the menu")
    finally:
        server.terminate()
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
