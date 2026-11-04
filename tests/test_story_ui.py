"""His Story on the page (web/recruiting.js): the Profile's His Story row ("Not Known Yet" muted until the staff
knows; then the story's label with its detail: a legacy's school, "Draft Risk: Some" for a Two-Sport recruit) and
a sentence under it; the pane's tag strip carries it as a chip (Title Case); an in-home visit plays the decider
bringing his story up, and the row patches to the story afterwards. At 400 px nothing scrolls sideways. Needs
Playwright with a Chromium; skipped without one. STORY_SHOTS=<folder> saves story-*.png screenshots."""
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch   # noqa: E402
from test_scene_window import WIN, answer_if_asked, open_board, pick_row, pitch, present_three, wait_server   # noqa: E402

SHOTS = os.environ.get("STORY_SHOTS")
NOT_KNOWN = "Not Known Yet"


def make_career():
    """A week-two career with three untouched prospects on the board: a Hometown Hero (public), a Two-Sport
    recruit with a complete report, and a legacy whose family decides (his story still unknown)."""
    import random
    from coach_career import persona, recruiting
    from sim import season
    me = "smu"
    st = season.new_season(me, "full", seed=23, career=True)
    season.advance_to(st, 2)
    rc = st["recruiting"]
    rc["hours"][me] = 300
    free = [q for q in recruiting.prospect_list(st) if not rc["prospects"][q].get("hidden") and me not in rc["contacts"].get(q, {})
            and not rc["status"][q]["committed"] and not recruiting.would_pester(st, me, q) and recruiting.report_looks(rc["reads"].get(q)) == 0]
    kind = lambda q: persona.story(st, q)[0]
    hero = next(q for q in free if kind(q) == "hero")
    two = next(q for q in free if kind(q) == "two_sport")
    legacy = next(q for q in free if kind(q) == "legacy" and persona.of(st, q)["decider"] != "self")
    other = next(q for q in free if kind(q) in ("two_sport", "package", "comeback") and persona.of(st, q)["decider"] != "self" and q not in (hero, two, legacy))
    rng = random.Random(3)
    for _ in range(3):
        recruiting.look(st, two, 70, rng, weight=1.0)
    rc["board"] = [hero, two, legacy, other]
    season.save_season(st)
    return st["id"], hero, two, legacy, other


def rows_of(page) -> dict:
    return page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.go-pane .go-trait')].map(r =>
        [r.dataset.trait, r.querySelector('.go-trait-val').textContent.trim()]))""")


def open_profile(page) -> None:
    page.click(".go-pane .go-subtabs button[data-sub=profile]")
    page.wait_for_selector(".go-pane .go-trait[data-trait=story]", timeout=30_000)
    time.sleep(0.4)


def chips(page) -> list:
    """His story's chip among the tags: the Overview's Recruit Snapshot carries them; the Profile tab opens again after."""
    page.click(".go-pane .go-subtabs button[data-sub=overview]")
    page.wait_for_selector(".go-pane [data-key=snapshot]", timeout=30_000)
    time.sleep(0.3)
    out = page.eval_on_selector_all(".go-pane .go-tags [data-key='trait:story']", "els => els.map(e => e.textContent.trim())")
    open_profile(page)
    return out


def no_null(page, what: str) -> None:
    assert not re.search(r"\b(null|undefined|NaN)\b", page.inner_text("body")), f"{what}: a raw value reached the page"


def shot(page, name: str) -> None:
    if SHOTS:
        Path(SHOTS).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(Path(SHOTS) / f"story-{name}.png"), full_page=False)


def desktop(browser, base, sid, hero, two, legacy, errs) -> None:
    from coach_career import persona
    from sim import season
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2, color_scheme="dark")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_board(page, base, sid)
    # a Hometown Hero is public: the row and the chip at once, with its sentence
    pick_row(page, hero)
    open_profile(page)
    rows = rows_of(page)
    assert rows["story"] == "Hometown Hero", rows
    assert page.text_content(".go-pane .go-trait[data-trait=story] .go-trait-label").strip() == "His Story"
    assert chips(page) == ["Hometown Hero"], chips(page)
    assert page.query_selector(".go-pane .go-trait[data-trait=story] .pv-note"), "a sentence says what his story means"
    no_null(page, "a hero")
    # Two-Sport, found by the complete report: the draft risk from you in words
    pick_row(page, two)
    open_profile(page)
    rows = rows_of(page)
    assert re.fullmatch(r"Two-Sport · Draft Risk: (High|Some|Low)", rows["story"]), rows
    assert chips(page) and chips(page)[0].startswith("Two-Sport · Draft Risk: "), chips(page)
    shot(page, "two-sport-1280")
    # the legacy: Not Known Yet (muted), until his family brings it up at a visit
    pick_row(page, legacy)
    open_profile(page)
    assert rows_of(page)["story"] == NOT_KNOWN
    assert page.query_selector(".go-pane .go-trait[data-trait=story] .go-trait-val.muted")
    assert not chips(page)
    page.click(".go-pane #rc-recruit")
    page.wait_for_selector(".go-menu[role=menu]")
    page.click(".go-menu .go-menu-item[data-action=hc_visit]")
    page.wait_for_selector(f"{WIN} .go-turn.family", timeout=30_000)
    time.sleep(0.5)
    st = season.load_season(sid)
    school = season.load_teams()[persona.story(st, legacy)[1]["school"]]["name"]
    fam = page.inner_text(f"{WIN} .go-turn.family")
    assert school in fam, (fam, school)
    no_null(page, "the visit")
    present_three(page)
    answer_if_asked(page)
    pitch(page)
    page.click(f"{WIN} .go-scene-close")
    page.wait_for_selector(WIN, state="hidden", timeout=10_000)
    time.sleep(0.8)
    open_profile(page)
    page.wait_for_function("() => /Legacy/.test(document.querySelector('.go-pane .go-trait[data-trait=story]')?.textContent || '')", timeout=10_000)
    assert rows_of(page)["story"] == f"Legacy · {school}", rows_of(page)
    assert chips(page) == [f"Legacy · {school}"], chips(page)
    shot(page, "profile-1280")
    page.click(".go-pane .go-subtabs button[data-sub=history]")
    page.wait_for_function("() => /Your staff learned he is a legacy at/.test(document.querySelector('.go-pane').innerText)", timeout=10_000)
    ctx.close()


def phone(browser, base, sid, hero, legacy, errs) -> None:
    ctx = browser.new_context(viewport={"width": 400, "height": 860}, device_scale_factor=2, color_scheme="dark", has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_board(page, base, sid)
    page.click(f".go-row-recruit[data-pid='{hero}']")
    page.wait_for_selector(".go-pane.sheet #rc-recruit", timeout=10_000)
    time.sleep(0.4)
    open_profile(page)
    assert rows_of(page)["story"] == "Hometown Hero"
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), "nothing scrolls sideways"
    no_null(page, "the profile at 400")
    ctx.close()
    if not SHOTS:
        return
    ctx = browser.new_context(viewport={"width": 400, "height": 860}, device_scale_factor=2, color_scheme="dark", has_touch=True)
    page = ctx.new_page()
    open_board(page, base, sid)
    page.click(f".go-row-recruit[data-pid='{legacy}']")
    page.wait_for_selector(".go-pane.sheet #rc-recruit", timeout=10_000)
    page.click(".go-pane.sheet #rc-recruit")
    page.wait_for_selector(".go-menu[role=menu]")
    page.click(".go-menu .go-menu-item[data-action=hc_visit]")
    page.wait_for_selector(f"{WIN} .go-turn.family", timeout=30_000)
    time.sleep(0.6)
    shot(page, "visit-400")
    ctx.close()


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("story ui skipped: Playwright is not installed")
        raise SystemExit(0)
    sid, hero, two, legacy, other = make_career()
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
                print(f"story ui skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            desktop(browser, base, sid, hero, two, legacy, errs)
            phone(browser, base, sid, hero, other, errs)
            browser.close()
        assert not errs, errs
        print("story ui ok: His Story row and chip, Draft Risk in words, a visit brings it up and the row patches, 1280 and 400")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
