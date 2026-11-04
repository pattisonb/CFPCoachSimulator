"""Twists and Commit Style on the page (web/recruiting.js): the Profile's Commit Style row ("Not Known Yet" muted
until an official visit or four weeks holding your offer; then its label and a sentence), his twist as a "What
Happened" row with its weeks left and its line, the pane's tag strip carrying both as chips (Title Case); a
Quiet Commit elsewhere reads "Quiet", not where; the Office's What Changed card carries the week's twist line.
At 400 px nothing scrolls sideways. Needs Playwright with a Chromium; skipped without one. TWIST_SHOTS=<folder>
saves twists-*.png screenshots."""
import os
import random
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch   # noqa: E402
from test_scene_window import open_board, pick_row, wait_server   # noqa: E402

SHOTS = os.environ.get("TWIST_SHOTS")
NOT_KNOWN = "Not Known Yet"
TITLE_SMALL = {"a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by"}


def make_career():
    """A week-two career: on the board a prospect whose commit style your staff knows (an official visit) with a
    Surprise Visit on, one with neither known, and a Quiet Commit who committed elsewhere; the week's report
    carries the twist."""
    from coach_career import persona, recruiting
    from sim import season
    me = "smu"
    st = season.new_season(me, "full", seed=23, career=True)
    season.advance_to(st, 2)
    rc = st["recruiting"]
    rc["hours"][me] = 300
    week = st["current_week"]
    free = [q for q in recruiting.prospect_list(st) if not rc["prospects"][q].get("hidden") and me not in rc["contacts"].get(q, {})
            and not rc["status"][q]["committed"] and not persona.story(st, q)[0] and q not in (rc.get("twists") or {})]
    known, unknown, quiet = free[0], free[1], next(q for q in free[2:] if persona.style(st, q) == "quiet")
    # his style: an official visit with you
    rc["prospects"][known]["persona"] = dict(persona.of(st, known), commit_style="hat")
    rc["visits"].setdefault(known, {})[me] = {"week": week, "done": True}
    persona.learn_styles(st, week)
    # his twist: a surprise visit by a school outside his top three
    for i, s in enumerate(("texas", "lsu", me, "oklahoma", "alabama", "georgia")):
        rc["lists"][known][s] = 30.0 - 4 * i
    tw, line = persona._setup(st, persona._Week(st, week), known, "surprise", random.Random(2))
    rc.setdefault("twists", {})[known] = tw
    recruiting._event(st, "twist", known, tw["s"], twist="surprise", line=line)
    # a quiet commit to someone else
    rc["offers"].setdefault("tcu", []).append(quiet)
    recruiting._commit(st, quiet, "tcu")
    rc["board"] = [known, unknown, quiet]
    rc["reports"] = [recruiting._report(st, week)]
    season.save_season(st)
    return st["id"], known, unknown, quiet, line, persona.twist_label(tw)


def rows_of(page) -> dict:
    return page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.go-pane .go-trait')].map(r =>
        [r.dataset.trait, r.querySelector('.go-trait-val').textContent.trim()]))""")


def open_profile(page) -> None:
    page.click(".go-pane .go-subtabs button[data-sub=profile]")
    page.wait_for_selector(".go-pane .go-trait[data-trait=story]", timeout=30_000)
    time.sleep(0.4)


def chip(page, key) -> list:
    return page.eval_on_selector_all(f".go-pane .go-tags [data-key='{key}']", "els => els.map(e => e.textContent.trim())")


def no_null(page, what: str) -> None:
    assert not re.search(r"\b(null|undefined|NaN)\b", page.inner_text("body")), f"{what}: a raw value reached the page"


def title_case(text: str) -> bool:
    words = [w for w in re.split(r"[\s·:]+", text) if w]
    return all(w[0].isupper() or w[0].isdigit() or (i and w.lower() in TITLE_SMALL) for i, w in enumerate(words))


def shot(page, name: str, selector: str = None) -> None:
    if not SHOTS:
        return
    Path(SHOTS).mkdir(parents=True, exist_ok=True)
    path = str(Path(SHOTS) / f"twists-{name}.png")
    if selector:
        page.locator(selector).first.screenshot(path=path)
    else:
        page.screenshot(path=path, full_page=False)


def profile_checks(page, known, unknown, quiet, label, line) -> None:
    pick_row(page, known)
    open_profile(page)
    rows = rows_of(page)
    assert rows["style"] == "Hat Ceremony", rows
    assert rows["twist"].startswith(label) and "Weeks Left" in rows["twist"], rows
    assert page.inner_text(".go-pane .go-trait[data-trait=style] .go-trait-label").strip() == "Commit Style"
    assert page.inner_text(".go-pane .go-trait[data-trait=twist] .go-trait-label").strip() == "What Happened"
    assert page.inner_text(".go-pane .go-twist-line").strip() == line
    assert page.query_selector(".go-pane .go-style-line"), "a sentence says what his commit style means"
    assert chip(page, "trait:style") == ["Hat Ceremony"] and chip(page, "twist") == [label], (chip(page, "trait:style"), chip(page, "twist"))
    for t in chip(page, "trait:style") + chip(page, "twist") + list(rows.values()):
        assert title_case(t), t
    no_null(page, "a known style and a twist")


def desktop(browser, base, sid, known, unknown, quiet, label, line, errs) -> None:
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2, color_scheme="dark")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_board(page, base, sid)
    profile_checks(page, known, unknown, quiet, label, line)
    shot(page, "profile-1280")
    # his style unknown: Not Known Yet, muted; no twist row
    pick_row(page, unknown)
    open_profile(page)
    rows = rows_of(page)
    assert rows["style"] == NOT_KNOWN and "twist" not in rows, rows
    assert page.query_selector(".go-pane .go-trait[data-trait=style] .go-trait-val.muted")
    assert not chip(page, "trait:style")
    # a quiet commit elsewhere: "Quiet", never where
    pick_row(page, quiet)
    pane = page.inner_text(".go-pane").lower()            # (the chip is set in capitals)
    head = pane.split("his list")[0]
    assert "quiet" in head and "tcu" not in head and "commit" not in head, head
    no_null(page, "a quiet commit")
    # the week's report: the twist's line
    page.click("#season-tabs button[data-tab=office]")
    page.wait_for_selector(".go-report", timeout=60_000)
    time.sleep(0.5)
    text = page.inner_text(".go-report")
    assert line.rstrip(".") in text, text
    no_null(page, "the report")
    shot(page, "report-1280", ".go-report")
    ctx.close()


def phone(browser, base, sid, known, unknown, quiet, label, line, errs) -> None:
    ctx = browser.new_context(viewport={"width": 400, "height": 860}, device_scale_factor=2, color_scheme="dark", has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_board(page, base, sid)
    page.click(f".go-row-recruit[data-pid='{known}']")
    page.wait_for_selector(".go-pane.sheet #rc-recruit", timeout=10_000)
    time.sleep(0.4)
    open_profile(page)
    rows = rows_of(page)
    assert rows["style"] == "Hat Ceremony" and rows["twist"].startswith(label), rows
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), "nothing scrolls sideways"
    no_null(page, "the profile at 400")
    page.locator(".go-pane .go-traits").first.scroll_into_view_if_needed()
    time.sleep(0.3)
    shot(page, "profile-400")
    ctx.close()
    ctx = browser.new_context(viewport={"width": 400, "height": 860}, device_scale_factor=2, color_scheme="dark", has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#season:visible")
    page.click("#season-tabs button[data-tab=office]")
    page.wait_for_selector(".go-report", timeout=60_000)
    time.sleep(0.5)
    assert line.rstrip(".") in page.inner_text(".go-report")
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), "the report fits at 400"
    shot(page, "report-400", ".go-report")
    ctx.close()


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("twists ui skipped: Playwright is not installed")
        raise SystemExit(0)
    sid, known, unknown, quiet, line, label = make_career()
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
                print(f"twists ui skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            desktop(browser, base, sid, known, unknown, quiet, label, line, errs)
            phone(browser, base, sid, known, unknown, quiet, label, line, errs)
            browser.close()
        assert not errs, errs
        print("twists ui ok: Commit Style row and chip, What Happened with its line, Quiet for a quiet commit, the report's twist line, 1280 and 400")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
