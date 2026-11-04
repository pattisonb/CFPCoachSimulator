"""The compact Prospect Profile (web/recruiting.js openProfile, web/recruiting.css).
For a fully scouted prospect on the board pane's Profile sub-tab at 1280x800 the whole profile, down to "Our comp", fits
without scrolling; the grades show once (the Scouted strip's chips, each with its "looks like" tooltip; no card grid); the
OC chip shows once and carries the coordinator's sentence as its title; the strip's note is an ⓘ; Personality and Who
Decides share one row; the summary line and "Our comp" sit under the Evaluation, before His List. At 400 px nothing runs
sideways and every control stands 44 px tall. Needs Playwright with a Chromium; skipped without one.
PROFILE_SHOTS=<folder> saves screenshots (deviceScaleFactor 2)."""
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
    open_tab(page, base, sid, "recruiting", ".go-stages")
    page.click(f".go-row-recruit[data-pid='{pid}']")
    page.click(".go-pane .go-subtabs button[data-sub=profile]")
    page.wait_for_selector(".go-pane .go-sub-body.go-profile .go-scouted .go-gchip.go-tip", timeout=60_000)
    page.wait_for_selector(".go-pane .go-sub-body.go-profile .go-comp", timeout=30_000)
    time.sleep(0.6)


def check_content(page, oc: str, where: str) -> None:
    assert not page.query_selector(".go-pane .go-profile .go-grades"), f"no second grade grid {where}"
    assert not page.query_selector(".go-pane .go-profile .go-likes-line"), f"no separate likes line {where}"
    assert page.evaluate("() => [...document.querySelectorAll('.go-pane .go-likes')].filter(e => e.getClientRects().length).length") == 1, f"the OC chip once {where}"
    assert page.get_attribute(".go-pane .go-likes", "title") == f"Your OC, {oc}, thinks he starts for you next year.", f"the chip carries the sentence {where}"
    chips = page.query_selector_all(".go-pane .go-profile .go-scouted .go-gchip")
    assert len(chips) == 6 and all("go-tip" in (c.get_attribute("class") or "") and c.query_selector(".go-tip-box") for c in chips), f"six grade chips, each with a tooltip {where}"
    info = page.query_selector(".go-pane .go-profile .go-scouted .go-info")
    assert info, f"the strip's note is an ⓘ {where}"
    assert "these are your staff's final grades" in page.evaluate("(b) => document.getElementById(b.getAttribute('aria-describedby')).textContent", info)
    assert "his report is complete" not in page.inner_text(".go-pane .go-profile").replace("\n", " "), f"the long note is off the page {where}"
    # one row: Personality and Who Decides side by side
    tops = page.eval_on_selector_all(".go-pane .go-profile .go-trait", "els => els.map(e => Math.round(e.getBoundingClientRect().top))")
    assert len(tops) == 2 and (where.endswith("400") or abs(tops[0] - tops[1]) <= 2), f"Personality and Who Decides share a row {where}: {tops}"
    # the order: strip, traits, evaluation, outlook, our comp, his list
    order = page.evaluate("""() => { const q = (s) => { const e = document.querySelector('.go-pane .go-profile ' + s); return e ? e.getBoundingClientRect().top : null; };
      return [q('.go-scouted'), q('.go-traits'), q('.rc-eval'), q('.go-outlook'), q('.go-comp'), q('.go-schools, .go-no-schools')]; }""")
    present = [t for t in order if t is not None]
    assert order[0] is not None and order[1] is not None and order[4] is not None and present == sorted(present), f"strip, traits, evaluation, summary, comp, list in that order {where}: {order}"


def desktop(browser, base, sid, pid, oc, errs) -> None:
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=2, color_scheme="light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_pane_profile(page, base, sid, pid)
    check_content(page, oc, "at 1280")
    page.evaluate("() => window.scrollTo(0, 1500)")      # the page scrolled until the pane sticks at the top of the window, as a player works it
    time.sleep(0.5)
    fit = page.evaluate("""() => { const c = document.querySelector('.go-pane .go-profile .go-comp'), pane = document.querySelector('.go-pane');
      const r = c.getBoundingClientRect(), pr = pane.getBoundingClientRect(); return { bottom: r.bottom, vh: innerHeight, paneBottom: pr.bottom, scrolled: pane.scrollTop, page: scrollY,
        paneScrolls: pane.scrollHeight > pane.clientHeight + 1 }; }""")
    assert fit["bottom"] <= fit["vh"] and fit["bottom"] <= fit["paneBottom"] + 0.5 and fit["scrolled"] == 0, f"Our comp is in view without scrolling the pane at 1280x800: {fit}"
    # the evaluation runs in two columns on a wide screen
    cols = page.evaluate("() => getComputedStyle(document.querySelector('.go-pane .go-profile .rc-eval')).columnCount")
    assert str(cols) == "2", f"two evaluation columns at 1280: {cols}"
    # a chip's tooltip opens on hover
    chip = page.query_selector(".go-pane .go-profile .go-scouted .go-gchip")
    chip.hover()
    time.sleep(0.3)
    assert page.query_selector(".go-pane .go-profile .go-tip-box.show"), "hovering a grade chip shows what it looks like"
    shot(page, "after-1280")
    page.mouse.move(2, 790)
    # the ⓘ opens too
    page.hover(".go-pane .go-profile .go-scouted .go-info")
    time.sleep(0.3)
    assert page.query_selector(".go-pane .go-profile .go-info-box.show"), "the ⓘ shows the note"
    ctx.close()


def phone(browser, base, sid, pid, oc, errs) -> None:
    ctx = browser.new_context(viewport={"width": 400, "height": 760}, device_scale_factor=2, color_scheme="light", has_touch=True, is_mobile=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_pane_profile(page, base, sid, pid)
    check_content(page, oc, "at 400")
    over = page.evaluate("""() => { const pane = document.querySelector('.go-pane'), pr = pane.getBoundingClientRect();
      return { page: document.documentElement.scrollWidth - innerWidth, pane: pane.scrollWidth - pane.clientWidth,
        out: [...pane.querySelectorAll('.go-profile *')].filter(e => e.getClientRects().length && !e.closest('.go-tip-box') && e.getBoundingClientRect().right > pr.right + 0.5).map(e => e.className || e.tagName).slice(0, 5) }; }""")
    assert over["page"] <= 0 and over["pane"] <= 0 and not over["out"], f"nothing runs sideways at 400: {over}"
    small = page.evaluate("""() => [...document.querySelectorAll('.go-pane .go-profile button, .go-pane .go-profile .go-gchip, .go-pane .go-profile .go-info')]
      .filter(e => e.getClientRects().length).map(e => [e.className, e.textContent.trim().slice(0, 20), Math.round(e.getBoundingClientRect().height)]).filter(x => x[2] < 44)""")
    assert not small, f"every control is 44 px tall at 400: {small}"
    cols = page.evaluate("() => getComputedStyle(document.querySelector('.go-pane .go-profile .rc-eval')).columnCount")
    assert str(cols) == "auto", f"one evaluation column on a phone: {cols}"
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
        print("profile compact ok: Our comp in view at 1280x800, grades once in the strip with tooltips, the OC chip once, one traits row, 400 px clean")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
