"""The compact profile, after the overhaul (web/profileview.js, web/recruiting.js): for a fully scouted prospect on the
board pane's Scouting tab at 1280x800 the Scouting Report down to its comp is in view without scrolling the pane; the
grades show once (the Attributes bars, each with its "looks like" tooltip, and the Potential headline; no grade grid, no
chip strip); the OC chip shows once and carries the coordinator's sentence as its title; the report's note about the
final grades is an ⓘ, off the page; the traits are easy to find (the Profile tab opens on one card with Who Decides,
Cares About, Personality and His Story). At 400 px nothing runs sideways, every control stands 44 px tall and the cards
stack. Needs Playwright with a Chromium; skipped without one. PROFILE_SHOTS=<folder> saves screenshots (deviceScaleFactor 2)."""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch   # noqa: E402
from test_scene_window import wait_server   # noqa: E402
from test_ux_sweep import open_tab   # noqa: E402

SHOTS = os.environ.get("PROFILE_SHOTS")


def make_career():
    """A career whose board holds a prospect with a complete report whose read says he starts (the OC chip)."""
    from coach_career import recruiting
    from sim import season
    me = "ohio-state"
    st = season.new_season(me, "full", seed=13, career=True)
    rc = st["recruiting"]
    oc = next(m["name"] for m in st["career"]["staff"] if m["role"] == "OC")
    tight = lambda p, looks: {"looks": float(looks), "area": 0.0, "by": {"95": float(looks)},
                              "g": {g: [min(99.0, p["truth"][g] + 40.0), 1000.0] for g in recruiting.GROUPS}}
    from coach_career import offseason
    pid = next(q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
               if recruiting._group_of(rc["prospects"][q]) == "QB" and not rc["prospects"][q].get("hidden")
               and not rc["status"][q]["signed"] and not rc["status"][q]["committed"]
               and sum(1 for o in recruiting._returning(me, "QB") if o >= rc["prospects"][q]["ovr"]) >= offseason.STARTERS["QB"])
    rc["reads"][pid] = tight(rc["prospects"][pid], 3)
    rc["board"] = [pid]
    season.save_season(st)
    return st["id"], pid, rc["prospects"][pid]["name"], oc


def shot(page, name: str) -> None:
    if SHOTS:
        Path(SHOTS).mkdir(parents=True, exist_ok=True)
        page.mouse.move(2, 2)
        time.sleep(0.3)
        page.screenshot(path=str(Path(SHOTS) / f"profile-compact-{name}.png"), full_page=False)


def open_pane_profile(page, base, sid, pid) -> None:
    """His pane on the Scouting tab: the Scouting Report (its comp) and the Attributes card (the grades)."""
    open_tab(page, base, sid, "recruiting", ".go-stages")
    page.click(f".go-row-recruit[data-pid='{pid}']")
    page.click(".go-pane .go-subtabs button[data-sub=scouting]")
    page.wait_for_selector(".go-pane .pv-attributes .pv-attr.go-tip", timeout=60_000)
    page.wait_for_selector(".go-pane .pv-report .go-comp", timeout=30_000)
    time.sleep(0.6)


def check_content(page, oc: str, where: str) -> None:
    # the grades show once: the Attributes bars, each with its "looks like" tooltip; no grade grid, no chip strip
    assert not page.query_selector(".go-pane .go-grades, .go-pane .go-scouted"), f"no second grade grid {where}"
    rows = page.query_selector_all(".go-pane .pv-attrs .pv-attr")
    assert page.evaluate("() => document.querySelectorAll('.go-pane .pv-attrs').length") == 1, f"the grades show once {where}"
    assert len(rows) == 5 and all("go-tip" in (c.get_attribute("class") or "") and c.query_selector(".go-tip-box") for c in rows), f"five attribute bars, each with a tooltip {where}"
    assert page.query_selector(".go-pane .pv-report .pv-potential.go-tip .go-tip-box"), f"the potential headline carries its tooltip {where}"
    # the OC chip shows once (the Scouting tab's flags) and carries the coordinator's sentence as its title; no separate likes line
    assert not page.query_selector(".go-pane .go-likes-line, .go-pane .pv-likes-line"), f"no separate likes line {where}"
    assert page.evaluate("() => [...document.querySelectorAll('.go-pane .go-likes')].filter(e => e.getClientRects().length).length") == 1, f"the OC chip once {where}"
    assert page.get_attribute(".go-pane .pv-uncertainty .go-likes", "title") == f"Your OC, {oc}, thinks he starts for you next year.", f"the chip carries the sentence {where}"
    # the report's note is an ⓘ: the long note about the final grades is off the page
    info = page.query_selector(".go-pane .pv-report .go-info")
    assert info, f"the report's note is an ⓘ {where}"
    assert "these are your staff's final grades" in page.evaluate("(b) => document.getElementById(b.getAttribute('aria-describedby')).textContent", info)
    assert "his report is complete" not in page.inner_text(".go-pane .go-sub-body").replace("\n", " ").lower(), f"the long note is off the page {where}"
    # the order in the report: the potential, the verdict, the lists, then the comp; the Attributes beside or under it
    order = page.evaluate("""() => { const q = (s) => { const e = document.querySelector('.go-pane ' + s); return e ? e.getBoundingClientRect().top : null; };
      return [q('.pv-report .pv-potential'), q('.pv-report .pv-verdict'), q('.pv-report .pv-cols'), q('.pv-report .go-comp')]; }""")
    assert None not in order and order == sorted(order), f"potential, verdict, lists, comp in that order {where}: {order}"
    # the traits are easy to find: the Profile tab opens on them, every row there at once, in view
    page.click(".go-pane .go-subtabs button[data-sub=profile]")
    page.wait_for_selector(".go-pane .pv-traits .go-trait", timeout=30_000)
    keys = page.eval_on_selector_all(".go-pane .pv-traits .go-trait", "els => els.map(e => e.dataset.trait)")
    assert keys[:4] == ["decider", "cares", "personality", "story"], f"Who Decides, Cares About, Personality and His Story in the traits card {where}: {keys}"
    fit = page.evaluate("() => { const e = document.querySelector('.go-pane .pv-traits'); return e.getBoundingClientRect().top < innerHeight; }")
    assert fit, f"the traits card starts in the first view of the Profile tab {where}"
    page.click(".go-pane .go-subtabs button[data-sub=scouting]")
    page.wait_for_selector(".go-pane .pv-attributes .pv-attr.go-tip", timeout=30_000)
    time.sleep(0.4)


def desktop(browser, base, sid, pid, oc, errs) -> None:
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=2, color_scheme="light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_pane_profile(page, base, sid, pid)
    check_content(page, oc, "at 1280")
    page.evaluate("() => window.scrollTo(0, 1500)")      # the page scrolled until the pane sticks at the top of the window, as a player works it
    time.sleep(0.5)
    fit = page.evaluate("""() => { const c = document.querySelector('.go-pane .pv-report .go-comp'), pane = document.querySelector('.go-pane');
      const r = c.getBoundingClientRect(), pr = pane.getBoundingClientRect(); return { bottom: r.bottom, vh: innerHeight, paneBottom: pr.bottom, scrolled: pane.scrollTop, page: scrollY,
        paneScrolls: pane.scrollHeight > pane.clientHeight + 1 }; }""")
    assert fit["bottom"] <= fit["vh"] and fit["bottom"] <= fit["paneBottom"] + 0.5 and fit["scrolled"] == 0, f"the comp is in view without scrolling the pane at 1280x800: {fit}"
    # the report and the Attributes sit side by side on a wide pane
    tops = page.evaluate("() => ['.pv-report', '.pv-attributes'].map(s => Math.round(document.querySelector('.go-pane ' + s).getBoundingClientRect().top))")
    assert abs(tops[0] - tops[1]) <= 1, f"the report and the Attributes side by side at 1280: {tops}"
    # a bar's tooltip opens on hover
    page.hover(".go-pane .pv-attributes .pv-attr >> nth=0")
    time.sleep(0.3)
    assert page.query_selector(".go-pane .go-tip-box.show"), "hovering a grade shows what it looks like"
    shot(page, "after-1280")
    page.mouse.move(2, 790)
    # the ⓘ opens too
    page.hover(".go-pane .pv-report .go-info")
    time.sleep(0.3)
    assert page.query_selector(".go-pane .go-info-box.show"), "the ⓘ shows the note"
    ctx.close()


def phone(browser, base, sid, pid, oc, errs) -> None:
    ctx = browser.new_context(viewport={"width": 400, "height": 760}, device_scale_factor=2, color_scheme="light", has_touch=True, is_mobile=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_pane_profile(page, base, sid, pid)
    check_content(page, oc, "at 400")
    over = page.evaluate("""() => { const pane = document.querySelector('.go-pane'), pr = pane.getBoundingClientRect();
      return { page: document.documentElement.scrollWidth - innerWidth, pane: pane.scrollWidth - pane.clientWidth,
        out: [...pane.querySelectorAll('.go-sub-body *')].filter(e => e.getClientRects().length && !e.closest('.go-tip-box, .go-info-box') && e.getBoundingClientRect().right > pr.right + 0.5).map(e => e.className || e.tagName).slice(0, 5) }; }""")
    assert over["page"] <= 0 and over["pane"] <= 0 and not over["out"], f"nothing runs sideways at 400: {over}"
    small = page.evaluate("""() => [...document.querySelectorAll('.go-pane .go-sub-body button, .go-pane .go-sub-body .go-tip, .go-pane .go-sub-body .go-info')]
      .filter(e => e.getClientRects().length).map(e => [e.className, e.textContent.trim().slice(0, 20), Math.round(e.getBoundingClientRect().height)]).filter(x => x[2] < 44)""")
    assert not small, f"every control is 44 px tall at 400: {small}"
    tops = page.evaluate("() => ['.pv-report', '.pv-attributes'].map(s => Math.round(document.querySelector('.go-pane ' + s).getBoundingClientRect().top))")
    assert tops[1] > tops[0], f"one column on a phone: the Attributes under the report {tops}"
    page.evaluate("() => { const p = document.querySelector('.go-pane'); p.scrollTop = 0; }")
    shot(page, "after-400")
    ctx.close()


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("profile compact skipped: Playwright is not installed")
        raise SystemExit(0)
    sid, pid, name, oc = make_career()
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    errs = []
    try:
        wait_server(base)
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"profile compact skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            desktop(browser, base, sid, pid, oc, errs)
            phone(browser, base, sid, pid, oc, errs)
            browser.close()
        assert not errs, errs
        print("profile compact ok: the comp in view at 1280x800, grades once as bars with tooltips, the OC chip once, the traits on the Profile tab, 400 px clean")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
