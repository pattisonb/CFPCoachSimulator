"""After a week on Auto-recruit, the recruits your staff called and messaged in the week step are yours
to contact in the new week: the pane's Recruit menu shows Message and Call enabled (no "Once a Week"
reason), for the recruit Auto-recruit worked (recruiting.contact_week; tests/test_contact_limits.py
holds the engine rules). Needs Playwright with a Chromium; skipped without one."""
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

ME = "smu"


def make_career():
    """A career one week in, played with Auto-recruit on for that week; the recruit it both called
    and messaged leads your board."""
    from sim import season
    st = season.new_season(ME, "full", seed=23, career=True)
    st["career"].setdefault("settings", {})["auto_recruit"] = "week"
    season.advance_to(st, 1)
    rc = st["recruiting"]
    worked = [q for q, by in rc["contacts"].items() if {"message", "call"} <= set((by.get(ME) or {}).get("week") or {})
              and not rc["status"][q]["signed"] and rc["status"][q]["committed"] in (None, ME)]
    assert worked, "Auto-recruit called and messaged nobody in the week"
    rc["board"] = [worked[0]] + [q for q in rc["board"] if q != worked[0]]
    season.save_season(st)
    return st["id"], worked[0]


def menu_items(page) -> dict:
    page.click(".go-pane #rc-recruit")
    page.wait_for_selector(".go-menu[role=menu]")
    out = page.eval_on_selector_all(".go-menu .go-menu-item", """els => Object.fromEntries(els.map((e) => [e.dataset.action,
        { disabled: e.getAttribute('aria-disabled') === 'true', why: (e.querySelector('.go-menu-why') || {}).textContent || '' }]))""")
    page.keyboard.press("Escape")
    return out


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("contact menu skipped: Playwright is not installed")
        raise SystemExit(0)
    sid, pid = make_career()
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
                print(f"contact menu skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            open_board(page, base, sid)
            pick_row(page, pid)
            items = menu_items(page)
            for action in ("message", "call"):
                assert not items[action]["disabled"], f"{action} is disabled after a week on Auto-recruit: {items[action]['why']}"
            browser.close()
            assert not errs, errs
        print("contact menu ok: after a week on Auto-recruit, Message and Call are open for the recruit your staff worked")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
