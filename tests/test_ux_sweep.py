"""The UX sweep's regressions, in a browser at desktop and phone width: no stray "null", no
number out of 100, depth-chart controls big enough to tap and never faint, labels that do not
clip, buttons that say what they do, class codes that read, tooltips reachable by tap, and the
confirms a one-tap skip needs. Needs Playwright with a Chromium; skipped without one."""
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

CLASS_CODE = re.compile(r"\b(FR|SO|JR|SR)RS\b")
OUT_OF_100 = re.compile(r"\b\d{1,3}\s*(/|of)\s*100\b")


def not_clipped(page, selector: str) -> list:
    """Elements whose text is wider than their box (ellipsis or cut off)."""
    return page.evaluate("""(sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetWidth && e.scrollWidth > e.clientWidth + 1)
                                 .map(e => `${e.className}: ${e.textContent.trim().slice(0, 40)} (${e.scrollWidth}>${e.clientWidth})`)""", selector)


def open_tab(page, base, sid, tab, wait):
    page.goto(f"{base}/season?id={sid}")
    page.wait_for_selector("#season:visible")
    page.click(f"#season-tabs button[data-tab={tab}]")
    page.wait_for_selector(wait, timeout=120_000)
    time.sleep(0.8)


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ux sweep skipped: Playwright is not installed")
        raise SystemExit(0)
    from sim import season
    from test_offseason import finished
    fresh = season.new_season("smu", "full", seed=62, career=True)
    season.save_season(fresh)
    done = season.new_season("ohio-state", "full", seed=8, career=True)
    finished(done)
    season.save_season(done)
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "server.py", "--local"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
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
                print(f"ux sweep skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 1000})
            errors, dialogs = [], []
            page.on("pageerror", lambda e: errors.append(str(e)))
            def dismiss(d):
                dialogs.append(d.message)
                d.dismiss()
            page.on("dialog", dismiss)
            A, B = fresh["id"], done["id"]

            # --- Office: the AD chip is a word, not a number out of 100
            open_tab(page, base, A, "office", ".go-program")
            office = page.inner_text("#tab-office")
            assert not OUT_OF_100.search(office), OUT_OF_100.search(office).group(0)
            assert "SECURE" in office.upper() or "SEAT" in office.upper(), "the AD's mood word is missing"

            # --- The US map: five cities project inside their own state outlines (Albers USA, with the AK and HI insets)
            hits = page.evaluate("""() => { const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox', US_STATES.viewBox); document.body.append(svg);
              const inside = (code, ll) => { const p = document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d', US_STATES.paths[code]); svg.append(p);
                const [x, y] = USMap.project(ll); const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; return p.isPointInFill(pt); };
              const r = [inside('TX', [29.76, -95.37]), inside('CA', [34.05, -118.24]), inside('AK', [61.22, -149.9]), inside('HI', [21.31, -157.86]), inside('FL', [25.76, -80.19])]; svg.remove(); return r; }""")
            assert all(hits), f"Houston, Los Angeles, Anchorage, Honolulu, Miami inside their states: {hits}"

            # --- Prospects: profile with three looks prints no "null", grades read "D to C-", scouting is a button
            open_tab(page, base, A, "prospects", ".go-list-row")
            page.click("button.go-chip:has-text('Recommended for you')")
            page.wait_for_selector("button.go-btn:has-text('Add these')", timeout=120_000)
            page.click("button.go-btn:has-text('Add these')")
            time.sleep(4)
            page.click(".go-list-row .go-list-id >> nth=0")
            page.wait_for_selector(".go-profile .go-display", timeout=60_000)
            for _ in range(3):
                sc = page.query_selector(".go-profile button:has-text('Send a scout')")
                if not sc:
                    break
                assert "go-link" not in (sc.get_attribute("class") or ""), "scouting costs hours: a button, not an inline link"
                sc.click()
                time.sleep(2.5)
                if not page.query_selector(".go-profile h2"):
                    page.click(".go-list-row .go-list-id >> nth=0")
                    page.wait_for_selector(".go-profile .go-display", timeout=60_000)
            page.wait_for_selector(".go-profile .go-scouted", timeout=30_000)
            prof = page.inner_text(".go-profile")
            assert not re.search(r"^null$", prof, re.M), "a null reached the profile"
            assert "–" not in page.inner_text(".go-profile .go-scouted"), "grade ranges read 'D to C-', not 'C-–D'"
            LETTER = re.compile(r"(^|\s)[A-D][+-]?(\s|$)|(^|\s)F(\s|$)")
            grades = page.inner_text(".go-profile .go-grades") + " " + page.inner_text(".go-profile .go-scouted")
            assert not LETTER.search(grades), f"a letter grade on the profile: {LETTER.search(grades).group(0)!r}"
            assert any(w in grades for w in ("All-American", "Elite", "Strong", "Solid", "Fair", "Weak")), grades
            assert "Generational" not in grades, "the grade tier must never read as the generational tag"
            assert "C+ starts at 50" not in page.inner_text(".go-profile"), "the letter legend is gone"
            assert page.query_selector(".go-profile .go-scouted .go-word") and page.query_selector(".go-profile .go-grades .go-word"), "grades render as .go-word tags"
            # a grade's "looks like" box opens on tap, not only on hover
            page.click(".go-profile .go-grades .go-tip >> nth=0")
            time.sleep(0.3)
            assert page.query_selector(".go-profile .go-tip-box.show"), "tapping a grade shows what it looks like"
            page.keyboard.press("Escape")
            # a disabled control is not a wait cursor
            cur = page.evaluate("() => { const b = document.querySelector('button:disabled'); return b ? getComputedStyle(b).cursor : 'none'; }")
            assert cur != "wait", cur

            # --- Recruiting board: tap a card on a phone and the pitch panel is right under it; the board's body holds the panel
            page.set_viewport_size({"width": 400, "height": 860})
            open_tab(page, base, A, "recruiting", ".go-pcard")
            page.click(".go-pcard .go-pcard-top >> nth=1")
            time.sleep(1)
            assert page.evaluate("() => { const c = document.querySelector('.go-pcard.selected'); return !!c && c.nextElementSibling && c.nextElementSibling.classList.contains('go-panel'); }"), \
                "on a phone the pitch panel sits right under the tapped card"
            page.set_viewport_size({"width": 1280, "height": 1000})
            open_tab(page, base, A, "recruiting", ".go-pcard")
            page.click(".go-pcard .go-pcard-top >> nth=0")
            time.sleep(1)
            over = page.evaluate("() => { const p = document.querySelector('.go-panel'), b = p && p.closest('.tab-body, #tab-recruiting'); if (!p || !b) return 0; return Math.round(p.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom); }")
            assert over <= 0, f"the pitch panel hangs {over}px below the board"

            # --- Staff: the area picker looks like a picker
            open_tab(page, base, A, "staff", ".rc-staff-card select")
            assert "go-sel" in (page.get_attribute(".rc-staff-card select", "class") or ""), "the scouting-area select is a house picker"

            # --- Schedule: the trade window says what the button does and names itself after the entry point
            open_tab(page, base, A, "schedule", ".schedule-pick")
            page.click(".schedule-pick button:has-text('Trade a non-conference game')")
            page.wait_for_selector(".sched-edit-row", timeout=60_000)
            assert "Trade a non-conference game" in page.inner_text(".modal-title >> visible=true")
            labels = page.evaluate("() => [...document.querySelectorAll('.sched-edit-row button')].map(b => b.textContent.trim())")
            assert labels and all(re.match(r"Trade (the )?week \d+", t) for t in labels), labels
            refused = page.evaluate("() => [...document.querySelectorAll('.sched-edit-row option')].filter(o => /· no:/.test(o.textContent)).map(o => o.disabled)")
            assert all(refused), "an option the other school refuses cannot be picked"
            page.keyboard.press("Escape")

            # --- Depth chart: controls big enough to tap, never faint, named; class codes read as "RS Sr."
            for width in (1280, 400):
                page.set_viewport_size({"width": width, "height": 1000})
                open_tab(page, base, A, "depth", "[data-player]")
                ctl = page.evaluate("""() => [...document.querySelectorAll('.depth-ctl button')].filter(b => b.offsetWidth).slice(0, 30).map(b => {
                    const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), op: getComputedStyle(b.closest('.depth-ctl')).opacity, label: b.getAttribute('aria-label') }; })""")
                assert ctl, "no depth controls"
                small = [c for c in ctl if c["w"] < 24 or c["h"] < 24]
                assert not small, f"{width}px: depth controls under 24px: {small[:3]}"
                assert all(c["op"] == "1" for c in ctl), f"{width}px: depth controls are faint without hover"
                assert all(c["label"] for c in ctl), "depth controls carry an aria-label"
                # your roster redshirts in place: an eligible player's row has the control, and it works both ways
                rsb = page.query_selector(".depth-rs:not(.on)")
                assert rsb, "no Redshirt control on an eligible player's row"
                if width == 1280:
                    assert "REDSHIRTING · 0" in page.inner_text(".depth-redshirts") and "Nobody is redshirting" in page.inner_text(".depth-redshirts")
                    rsb.click(); page.wait_for_selector(".depth-redshirt", timeout=30_000)
                    assert "REDSHIRTING · 1" in page.inner_text(".depth-redshirts"), "the redshirt list shows him"
                    page.click(".depth-redshirt .depth-rs.on"); page.wait_for_function("() => !document.querySelector('.depth-rs.on')", timeout=30_000)
                    assert "Nobody is redshirting" in page.inner_text(".depth-redshirts")
                depth = page.inner_text("#tab-depth")
                assert not CLASS_CODE.search(depth), CLASS_CODE.search(depth).group(0)
                # a player page: attribute labels do not clip; the bar colours are explained
                keys = page.evaluate("() => [...document.querySelectorAll('[data-player]')].slice(0, 3).map(e => e.dataset.player)")
                page.click(f"[data-player='{keys[1]}']")
                page.wait_for_selector(".player-page", timeout=60_000)
                time.sleep(1.5)
                clipped = not_clipped(page, ".player-page .rating-label")
                assert not clipped, f"{width}px: {clipped[:3]}"
                legend = page.inner_text(".player-page")
                assert "75" in legend and ("red" in legend.lower() or "green" in legend.lower()), "the rating bar colours are explained"
                assert not CLASS_CODE.search(legend), CLASS_CODE.search(legend).group(0)
                page.keyboard.press("Escape")
            page.set_viewport_size({"width": 1280, "height": 1000})

            # --- Offseason, every stage: no number out of 100, no run-together class codes
            page.goto(f"{base}/season?id={B}")
            page.wait_for_selector("#tab-offseason .off-steps", timeout=120_000)
            off = page.inner_text("#tab-offseason")
            assert not OUT_OF_100.search(off), OUT_OF_100.search(off).group(0)
            assert not CLASS_CODE.search(off), CLASS_CODE.search(off).group(0)
            # "Sim to next season" asks first: dismissed, nothing moves
            n_dialogs = len(dialogs)
            page.click("#tab-offseason button:has-text('Sim to next season')")
            time.sleep(1)
            assert len(dialogs) == n_dialogs + 1, "skipping the whole offseason asks first"
            assert call(base, f"/api/season/{B}/offseason")["stage"] == "departures"
            call(base, f"/api/season/{B}/offseason/advance", {})
            v = call(base, f"/api/season/{B}/offseason")
            if v["stage"] == "retention":
                page.goto(f"{base}/season?id={B}")
                page.wait_for_selector("text=WANT OUT", timeout=120_000)
                time.sleep(0.8)
                clipped = not_clipped(page, ".off-keep-acts button b")
                assert not clipped, clipped[:3]
                keep = page.inner_text("#tab-offseason")
                assert not CLASS_CODE.search(keep), CLASS_CODE.search(keep).group(0)
                # letting a player go asks first
                n_dialogs = len(dialogs)
                page.click(".off-keep button.go-act:has-text('Let him go') >> nth=0")
                time.sleep(0.8)
                assert len(dialogs) == n_dialogs + 1, "letting a player go asks first"
                assert "letting go" not in page.inner_text(".off-keep .go-pcard >> nth=0")
                call(base, f"/api/season/{B}/offseason/advance", {})
            # the portal board: a transfer has no star row
            page.goto(f"{base}/season?id={B}")
            page.wait_for_selector("text=WEEK 1 OF 4", timeout=120_000)
            time.sleep(0.8)
            hollow = page.evaluate("() => [...document.querySelectorAll('.go-pcard .go-stars')].filter(e => /^☆+$/.test(e.textContent.trim())).length")
            assert hollow == 0, f"{hollow} transfer cards show an empty star row"
            page.set_viewport_size({"width": 400, "height": 860})
            page.click("#season-tabs button[data-tab=prospects]")
            page.wait_for_selector(".go-list-row", timeout=60_000)
            time.sleep(0.8)
            clipped = not_clipped(page, ".go-list-row .go-tag")
            assert not clipped, clipped[:3]
            page.set_viewport_size({"width": 1280, "height": 1000})
            for _ in range(5):
                call(base, f"/api/season/{B}/offseason/advance", {})
            assert call(base, f"/api/season/{B}/offseason")["stage"] == "staff"
            page.goto(f"{base}/season?id={B}")
            page.wait_for_selector("text=COACHES FOR HIRE", timeout=120_000)
            time.sleep(0.8)
            staff = page.inner_text("#tab-offseason")
            assert not OUT_OF_100.search(staff), OUT_OF_100.search(staff).group(0)
            dup = page.evaluate("() => [...document.querySelectorAll('.off-table tbody tr')].filter(r => r.cells[3].textContent.trim() === r.cells[4].textContent.trim()).length")
            assert dup == 0, f"{dup} coaches repeat why they are available as their last job"
            lg = page.query_selector("button.go-act:has-text('Let him go')")
            if lg:
                page.remove_listener("dialog", dismiss)
                page.once("dialog", lambda d: d.accept())
                lg.click()
                page.wait_for_selector(".off-cand", timeout=60_000)
                hire = page.get_attribute(".off-cand > :last-child", "class") or ""
                assert "go-btn" in hire, f"the hire control reads as a button, not a tag ({hire})"
            # the server forgets a career (a deploy, a restart) but this device kept it: the list still offers
            # "Clear all" and a delete on the device-saved row, so seasons can always be cleared
            page.goto(f"{base}/season?id={A}")
            page.wait_for_selector("#season:visible")
            page.wait_for_function("() => window.CareerSave && window.CareerSave.list().then(l => window.__kept = l.length) && window.__kept > 0", timeout=60_000)
            call(base, f"/api/season/{A}", method="DELETE")
            page.goto(f"{base}/season")
            page.wait_for_selector("#season-list li", timeout=60_000)
            page.wait_for_function("() => /saved on this device/.test(document.querySelector('#season-list').innerText)", timeout=60_000)
            assert page.is_visible("#btn-clear-seasons"), "Clear all is offered for device-saved careers"
            try:
                page.remove_listener("dialog", dismiss)
            except Exception:  # noqa: BLE001 - already removed by the staff step
                pass
            page.on("dialog", lambda d: d.accept())
            page.click("#season-list li:has-text('saved on this device') button.del")
            page.wait_for_function("() => !/saved on this device/.test(document.querySelector('#season-list').innerText)", timeout=30_000)
            browser.close()
        assert not errors, errors
        print("ux sweep ok: office, prospects, board, staff, schedule, depth, player page and every offseason stage at 1280 and 400")
    finally:
        server.terminate()
        for sid in (fresh["id"], done["id"]):
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
