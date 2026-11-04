"""Personality and decider on the page, scouting points in the Scouting Center (web/recruiting.js, web/scouting.js).
His Profile shows a Personality row and a Who Decides row, each "Not Known Yet" until the staff learns it (a first call
tells the personality, two looks tell who decides, plus "Cares About: <Topic>"); the pane's tag strip carries the known
traits as chips; a learned trait patches in place (switching recruits starts no pulse or fade). The Scouting Center
header reads "Points Left: N of M", each Send reads "10 Points" / "15 Points" / "5 Points", a Send the week cannot pay
is disabled with its reason. An in-home visit with a decider other than himself plays a family turn under the
decider's label; a Guarded call (no topics cued) still plays and still lets you pitch any topic. At 400 px the new
controls stand 44 px tall. Needs Playwright with a Chromium; skipped without one.
PERSONA_SHOTS=<folder> saves persona-*.png screenshots."""
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
from test_scene_window import (QUIET_READ, QUIET_WATCH, WIN, open_board, pick_row, present_three, start_call,   # noqa: E402
                               wait_server, answer_if_asked, pitch)
from test_ux_sweep import PITCH, open_tab, toasted   # noqa: E402

SHOTS = os.environ.get("PERSONA_SHOTS")
NOT_KNOWN = "Not Known Yet"
NO_POINTS = "Not enough scouting points left this week."


def make_career():
    """A week-two career with hours to spend and three untouched prospects on the board: one who is not Guarded (a call
    tells his personality), one whose family decides (a visit plays a family turn), one Guarded (a call cues nothing)."""
    from coach_career import persona, recruiting
    from sim import season
    me = "smu"
    st = season.new_season(me, "full", seed=23, career=True)
    season.advance_to(st, 2)
    rc = st["recruiting"]
    rc["hours"][me] = 300
    free = [q for q in recruiting.prospect_list(st) if not rc["prospects"][q].get("hidden") and me not in rc["contacts"].get(q, {})
            and not rc["status"][q]["committed"] and not recruiting.would_pester(st, me, q)]
    of = lambda q: persona.of(st, q)
    first = next(q for q in free if of(q)["personality"] not in ("guarded",) and of(q)["decider"] != "self" and of(q)["decider_topic"])
    visit = next(q for q in free if q != first and of(q)["decider"] != "self" and of(q)["personality"] != "guarded")
    guarded = next(q for q in free if of(q)["personality"] == "guarded" and q not in (first, visit))
    rc["board"] = [first, visit, guarded]
    season.save_season(st)
    return st["id"], first, visit, guarded, {q: rc["prospects"][q]["name"] for q in (first, visit, guarded)}


def profile_rows(page) -> dict:
    return page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.go-pane .go-trait')].map(r =>
        [r.dataset.trait, r.querySelector('.go-trait-val').textContent.trim()]))""")


def open_profile(page) -> None:
    page.click(".go-pane .go-subtabs button[data-sub=profile]")
    page.wait_for_selector(".go-pane .go-trait", timeout=30_000)
    time.sleep(0.4)


def no_null(page, what: str) -> None:
    text = page.inner_text("body")
    assert not re.search(r"\b(null|undefined|NaN)\b", text), f"{what}: a raw value reached the page"


def shot(page, name: str) -> None:
    if SHOTS:
        Path(SHOTS).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(Path(SHOTS) / f"persona-{name}.png"), full_page=False)


def finish_call(page) -> None:
    present_three(page)
    answer_if_asked(page)
    pitch(page)
    page.click(f"{WIN} .go-scene-close")
    page.wait_for_selector(WIN, state="hidden", timeout=10_000)
    time.sleep(0.6)


def desktop(browser, base, sid, first, visit, guarded, names, errs) -> None:
    from coach_career import persona
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2, color_scheme="dark")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_board(page, base, sid)
    # before contact: both rows say Not Known Yet, no trait chip in the tag strip
    pick_row(page, first)
    open_profile(page)
    rows = profile_rows(page)
    assert rows == {"personality": NOT_KNOWN, "decider": NOT_KNOWN}, rows
    assert page.inner_text(".go-pane .go-trait[data-trait=personality] .go-trait-label").strip() == "Personality"
    assert page.inner_text(".go-pane .go-trait[data-trait=decider] .go-trait-label").strip() == "Who Decides"
    assert page.eval_on_selector_all(".go-pane .go-trait .go-trait-val.muted", "els => els.length") == 2, "Not Known Yet is muted"
    assert not page.query_selector(".go-pane .go-tags [data-key^='trait:']"), "no trait chip before anything is learned"
    # switching recruits starts no pulse or fade
    page.evaluate(QUIET_WATCH, [".go-pane", ["go-changed", "go-fade-in"]])
    pick_row(page, visit)
    pick_row(page, first)
    loud, what = page.evaluate(QUIET_READ)
    assert loud == 0, f"switching recruits flashed or faded {loud} time(s): {what}"
    # a first call tells his personality
    start_call(page)
    finish_call(page)
    open_profile(page)
    rows = profile_rows(page)
    labels = set(persona.PERSONALITY_LABEL.values())
    assert rows["personality"] in labels, rows
    assert rows["decider"] == NOT_KNOWN, rows
    chips = page.eval_on_selector_all(".go-pane .go-tags [data-key^='trait:']", "els => els.map(e => e.textContent.trim())")
    assert rows["personality"] in chips, (chips, rows)
    no_null(page, "after the call")
    scout_item(page, base, sid, first)
    # the Scouting Center: Points Left, a cost on each Send, two looks tell who decides
    open_tab(page, base, sid, "scouting", ".sc-list .sc-row")
    page.wait_for_selector(".sc-intel .sc-big-name", timeout=30_000)
    v = call(base, f"/api/season/{sid}/scouting")
    head = page.inner_text(".sc-head")
    assert re.search(r"Points Left: \d+ of \d+", head), head
    assert f"Points Left: {v['points_left']} of {v['points_week']}" in head, (head, v["points_left"], v["points_week"])
    assert "scouting points" in head.lower() and "scouting hours" not in head.lower(), head
    assert page.inner_text("#sc-points-card .sc-points-val").strip() == str(v["points_left"]), "the points are the card's headline"
    assert f"recruiting hours: {v['hours_left']} of {v['hours']}" in head.lower(), head
    shot(page, "scouting-1280")
    page.fill("#sc-search", names[first])
    page.wait_for_selector(f".sc-row[data-pid='{first}']", timeout=10_000)
    page.click(f".sc-row[data-pid='{first}'] .sc-row-btn")
    page.wait_for_function("(n) => document.querySelector('.sc-intel .sc-big-name')?.textContent.trim() === n", arg=names[first], timeout=30_000)
    for i in range(2):
        before = call(base, f"/api/season/{sid}/scouting")["points_left"]
        btn = page.inner_text("#sc-send")
        m = re.search(r"\b(\d+) Points\b", btn)
        assert m and int(m.group(1)) in (5, 10, 15), btn
        cost = int(m.group(1))
        page.click("#sc-send")
        page.wait_for_function("(p) => new RegExp('Points Left: ' + p + ' of').test(document.querySelector('.sc-head').textContent)", arg=before - cost, timeout=10_000)
        assert call(base, f"/api/season/{sid}/scouting")["points_left"] == before - cost
        time.sleep(0.5)
    # back on the board, his profile now shows who decides (and what that person cares about)
    open_tab(page, base, sid, "recruiting", ".go-row-recruit")
    pick_row(page, first)
    open_profile(page)
    rows = profile_rows(page)
    assert rows["decider"] != NOT_KNOWN and rows["personality"] != NOT_KNOWN, rows
    assert rows["decider"].split(" · ")[0].split(" Cares About")[0] in persona.DECIDER_LABEL.values(), rows
    assert "Cares About: " in rows["decider"], rows
    chips = page.eval_on_selector_all(".go-pane .go-tags [data-key^='trait:']", "els => els.map(e => e.textContent.trim())")
    assert len(chips) == 2, chips
    no_null(page, "after the looks")
    shot(page, "profile-1280")
    # an in-home visit with a family decider plays a family turn under the decider's label
    pick_row(page, visit)
    page.click(".go-pane #rc-recruit")
    page.wait_for_selector(".go-menu[role=menu]")
    page.click(".go-menu .go-menu-item[data-action=hc_visit]")
    page.wait_for_selector(f"{WIN} .go-scene .go-opening", timeout=30_000)
    time.sleep(0.4)
    fam = page.eval_on_selector_all(f"{WIN} .go-turn.family", "els => els.map(e => [e.querySelector('.go-turn-who')?.textContent.trim(), e.textContent])")
    assert len(fam) == 1, fam
    label = persona.DECIDER_LABEL[persona.of(_state(sid), visit)["decider"]]
    assert fam[0][0] == f"{label}:", fam
    assert "null" not in fam[0][1] and "undefined" not in fam[0][1]
    ctx.close()
    # a Guarded call cues no topic: no star, and the pitch still picks any topic
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme="dark")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_board(page, base, sid)
    pick_row(page, guarded)
    start_call(page)
    present_three(page)
    answer_if_asked(page)
    chosen = page.eval_on_selector_all(f"{WIN} .go-pitches input", "els => els.length")
    assert chosen >= 5, "the pitch picker lists the topics"
    assert not page.query_selector(f"{WIN} .go-pitch.cue"), "a Guarded call stars no topic"
    assert not page.query_selector(".go-pane .go-tag.cue"), "no starred topic"
    page.click(f"{WIN} .go-pitches label.go-pitch:nth-child(2)")      # nothing is picked for him: choose any topic
    topic = page.eval_on_selector(f"{WIN} .go-pitches label.go-pitch:nth-child(2) input", "e => e.value")
    re_ = pitch(page)
    # he gave nothing away: the reaction's kind is neutral (no hit or quiet border), the toast and History say so
    assert re_["kind"] == "guarded", re_
    cls = page.get_attribute(f"{WIN} .go-reaction", "class").split()
    assert "hit" not in cls and "quiet" not in cls and "polite" not in cls, cls
    toasted(page, f"Pitch: {PITCH[topic]} · He gave nothing away")
    log = [e for e in _state(sid)["recruiting"]["log"] if e["pid"] == guarded and e.get("school") == _state(sid)["team"]]
    assert next(e for e in log if e["kind"] == "pitch")["reaction"] == "guarded", log
    assert next(e for e in log if e["kind"] == "present")["hit"] is None, log
    page.click(f"{WIN} .go-scene-close")
    page.wait_for_selector(WIN, state="hidden", timeout=10_000)
    time.sleep(0.6)
    page.click(".go-pane .go-subtabs button[data-sub=history]")
    page.wait_for_function("() => /gave nothing away/.test(document.querySelector('.go-pane').innerText)", timeout=10_000)
    hist = page.inner_text(".go-pane")
    assert f"Call · {PITCH[topic]} · He gave nothing away" in hist, hist
    assert re.search(r"Presented [a-zA-Z ]+, [a-zA-Z ]+, [a-zA-Z ]+ · He gave nothing away", hist), hist
    assert "landed" not in hist and "He lit up" not in hist and "He went quiet" not in hist, hist
    no_null(page, "after the Guarded call")
    ctx.close()


def _state(sid):
    from sim import season
    return season.load_season(sid)


def scout_item(page, base, sid, pid) -> None:
    """The Recruit menu's Scout item carries the look's point cost and waits with the Scouting Center's reason when short."""
    b = next(x for x in call(base, f"/api/season/{sid}/recruiting")["board"] if x["id"] == pid)
    left = call(base, f"/api/season/{sid}/recruiting")["points_left"]
    assert b["scout_cost"] in (5, 10, 15) and left == call(base, f"/api/season/{sid}/scouting")["points_left"], (b["scout_cost"], left)
    page.click(".go-pane #rc-recruit")
    page.wait_for_selector(".go-menu[role=menu]")
    item = page.query_selector(".go-menu .go-menu-item[data-action=scout]")
    text = item.inner_text()
    assert re.search(rf"Scout\s+{b['scout_cost']} Points · [\d.]+ of 3 Looks", text.replace("\n", " ")), text
    short = left < b["scout_cost"] and (b["looks"] or 0) < 3
    if page.viewport_size["width"] < 500:
        assert short, "the drain left his Scout item short of points"
    if short:
        assert item.get_attribute("aria-disabled") == "true" and NO_POINTS in text, text
    elif (b["looks"] or 0) < 3:
        assert item.get_attribute("aria-disabled") != "true", text
    page.keyboard.press("Escape")


def drained(page, base, sid, keep) -> dict:
    ctx = page  # the page is the desktop one reopened below
    v = call(base, f"/api/season/{sid}/scouting?limit=400")
    target = next(r for r in v["queue"] if r["can_send"] and (r["looks"] or 0) == 0 and not r["on_board"] and r["pid"] not in keep)
    pts = v["points_left"]
    for r in v["queue"]:
        if r["pid"] == target["pid"] or r["pid"] in keep or not r["can_send"]:
            continue
        if pts - r["cost"] < 0:
            continue
        try:
            call(base, f"/api/season/{sid}/recruit", {"pid": r["pid"], "action": "scout"})
            pts -= r["cost"]
        except Exception:   # noqa: BLE001
            continue
    now = call(base, f"/api/season/{sid}/scouting?limit=400")
    row = next(r for r in now["queue"] if r["pid"] == target["pid"])
    assert now["points_left"] < row["cost"], (now["points_left"], row["cost"])
    return row


def phone(browser, base, sid, board_pids, errs) -> None:
    ctx = browser.new_context(viewport={"width": 400, "height": 860}, device_scale_factor=2, color_scheme="dark", has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    row = drained(None, base, sid, set(board_pids))
    open_tab(page, base, sid, "scouting", ".sc-list .sc-row")
    page.fill("#sc-search", row["name"])
    page.wait_for_selector(f".sc-row[data-pid='{row['pid']}']", timeout=10_000)
    page.click(f".sc-row[data-pid='{row['pid']}'] .sc-row-btn")
    page.wait_for_function("(n) => document.querySelector('.sc-intel .sc-big-name')?.textContent.trim() === n", arg=row["name"], timeout=30_000)
    send = page.query_selector("#sc-send")
    assert send.is_disabled() and send.get_attribute("title") == NO_POINTS, (send.get_attribute("title"), send.is_disabled())
    assert re.search(rf"\b{row['cost']} Points\b", send.inner_text()), send.inner_text()
    assert NO_POINTS in page.inner_text(".sc-intel .sc-why"), "the reason is written beside the actions"
    # his profile (the modal) waits too: Send a Scout is disabled with the same reason
    page.goto(f"{base}/index.html?id={sid}&tab=prospects&modal=profile:{row['pid']}")
    page.wait_for_selector(".modal:not([hidden]) .rc-profile-name", timeout=60_000)
    btn = page.wait_for_selector(".modal:not([hidden]) .rc-profile-actions button:has-text('Send a Scout')", timeout=10_000)
    assert btn.is_disabled() and btn.get_attribute("title") == NO_POINTS, (btn.is_disabled(), btn.get_attribute("title"))
    assert re.search(rf"\b{row['cost']} Points\b", btn.inner_text()), btn.inner_text()
    page.goto(f"{base}/index.html?id={sid}&tab=scouting")
    page.wait_for_selector(".sc-list .sc-row", timeout=60_000)
    page.fill("#sc-search", row["name"])
    page.wait_for_selector(f".sc-row[data-pid='{row['pid']}']", timeout=10_000)
    page.click(f".sc-row[data-pid='{row['pid']}'] .sc-row-btn")
    page.wait_for_function("(n) => document.querySelector('.sc-intel .sc-big-name')?.textContent.trim() === n", arg=row["name"], timeout=30_000)
    assert re.search(r"Points Left: \d+ of \d+", page.inner_text(".sc-head"))
    h = page.eval_on_selector("#sc-send", "e => e.getBoundingClientRect().height")
    assert h >= 44, h
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), "nothing scrolls sideways"
    no_null(page, "scouting at 400")
    # the board's Recruit menu agrees: his Scout item is out of points too (a board prospect the drain left short, or the cost shown)
    open_board(page, base, sid)
    for pid in board_pids[:1]:      # the sheet covers the list on a phone: one pick, and the drain left him short
        page.click(f".go-row-recruit[data-pid='{pid}']")
        page.wait_for_selector(".go-pane.sheet #rc-recruit", timeout=10_000)
        time.sleep(0.4)
        scout_item(page, base, sid, pid)
    ctx.close()


def phone_board(browser, base, sid, first, errs) -> None:
    ctx = browser.new_context(viewport={"width": 400, "height": 860}, device_scale_factor=2, color_scheme="dark", has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_board(page, base, sid)
    page.click(f".go-row-recruit[data-pid='{first}']")
    page.wait_for_selector(".go-pane.sheet #rc-recruit", timeout=10_000)
    time.sleep(0.5)
    open_profile(page)
    rows = profile_rows(page)
    assert all(v != "" for v in rows.values()) and set(rows) == {"personality", "decider"}, rows
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), "nothing scrolls sideways"
    no_null(page, "profile at 400")
    ctx.close()


def visit_shot(browser, base, sid, visit, errs) -> None:
    if not SHOTS:
        return
    ctx = browser.new_context(viewport={"width": 400, "height": 860}, device_scale_factor=2, color_scheme="dark", has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    open_board(page, base, sid)
    page.click(f".go-row-recruit[data-pid='{visit}']")
    page.wait_for_selector(".go-pane.sheet #rc-recruit", timeout=10_000)
    if page.query_selector(".go-pane.sheet #rc-finish"):
        page.click(".go-pane.sheet #rc-finish")
    else:
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
        print("persona ui skipped: Playwright is not installed")
        raise SystemExit(0)
    sid, first, visit, guarded, names = make_career()
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
                print(f"persona ui skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            desktop(browser, base, sid, first, visit, guarded, names, errs)
            visit_shot(browser, base, sid, visit, errs)
            phone_board(browser, base, sid, first, errs)
            phone(browser, base, sid, [first, visit, guarded], errs)
            browser.close()
        assert not errs, errs
        print("persona ui ok: traits on the profile and the pane, Points Left and a cost on each Send, a family turn, a Guarded call, 1280 and 400")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
