"""The UX sweep's regressions, in a browser at desktop and phone width: no stray "null", no
number out of 100, depth-chart controls big enough to tap and never faint, labels that do not
clip, buttons that say what they do, class codes that read, tooltips reachable by tap, and the
confirms a one-tap skip needs. Needs Playwright with a Chromium; skipped without one."""
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
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


SHOTS = os.environ.get("UX_SHOTS")      # a folder: the sweep saves its screenshots there (none by default)


def shot(page, name: str) -> None:
    if SHOTS:
        Path(SHOTS).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(Path(SHOTS) / f"{name}.png"), full_page=False)


def draws(page) -> int:
    """The board's draw counter (web/recruiting.js stamps it on every draw and every patch)."""
    return page.evaluate("() => +(document.querySelector('.rc-head').parentElement.dataset.draw || 0)")


def settle(page, before: int) -> None:
    """The board re-fetches after an action lands and patches itself; wait for that patch before the next click."""
    page.wait_for_function("(n) => +(document.querySelector('.rc-head').parentElement.dataset.draw || 0) > n", arg=before, timeout=30_000)
    time.sleep(0.3)


# ----- smoothness (the spec's section 5): an action patches the screen in place, says what happened, keeps the focus -----

def watch(page, selector: str, control: str = None, scrolled: bool = True):
    """Before an action: the element the player is looking at (a handle), the page's and its own scroll, and an observer
    counting the removals of any node that holds it. control: the button about to be clicked, brought into view first
    if it is off screen (Playwright scrolls an off-screen control into view itself, which the scroll check must not count).
    scrolled: the page is scrolled (so the scroll check means something)."""
    if control:
        page.eval_on_selector(control, "e => e.scrollIntoView({ block: 'nearest' })")
        time.sleep(0.3)
    h = page.query_selector(selector)
    assert h, selector
    s = page.evaluate("""(el) => { const s = window.__smooth = { el, gone: 0, top: el.scrollTop, page: window.scrollY };
        s.mo = new MutationObserver((ms) => { for (const m of ms) for (const n of m.removedNodes) if (n === el || (n.nodeType === 1 && n.contains(el))) s.gone++; });
        s.mo.observe(document.documentElement, { childList: true, subtree: true }); return { page: s.page, top: s.top }; }""", h)
    if scrolled:
        assert s["page"] > 0, f"the page is not scrolled ({s}), so the scroll check would pass for nothing"
    return h


def toasted(page, text: str) -> None:
    """A toast with that exact sentence is on the stack (it leaves on its own later)."""
    page.wait_for_function("(t) => [...document.querySelectorAll('#toasts .toast-item')].some(e => e.textContent.trim() === t)", arg=text, timeout=30_000)


def smooth(page, h, what: str, same: bool = True) -> None:
    """After the action landed: the watched element is still the one on screen (or, same=False, the pane switched),
    nothing that held it was removed, the scrolls are within 2 px, and the focus is on a control, not the body."""
    r = page.evaluate("""(el) => { const s = window.__smooth; s.mo.disconnect();
        return { connected: el.isConnected, gone: s.gone, top: el.isConnected ? el.scrollTop - s.top : 0, page: window.scrollY - s.page, active: document.activeElement.tagName,
                 pane: !!document.querySelector('.go-pane') }; }""", h)
    if same:
        assert r["connected"] and r["gone"] == 0, f"{what}: the pane was rebuilt ({r})"
    else:
        assert r["pane"] and not r["connected"], f"{what}: the pane should have switched ({r})"
    assert abs(r["page"]) <= 2 and abs(r["top"]) <= 2, f"{what}: the scroll jumped ({r})"
    assert r["active"] != "BODY", f"{what}: the focus fell to the body"


def no_overlap(page, a: str, b: str) -> bool:
    return page.evaluate("""([a, b]) => { const x = document.querySelector(a), y = document.querySelector(b); if (!x || !y) return false;
        const p = x.getBoundingClientRect(), q = y.getBoundingClientRect(); return p.right <= q.left || p.left >= q.right || p.bottom <= q.top || p.top >= q.bottom; }""", [a, b])


def wait_week(base, sid) -> None:
    call(base, f"/api/season/{sid}/advance", {})
    for _ in range(1200):
        if call(base, f"/api/season/{sid}/status")["status"] != "running":
            break
        time.sleep(0.5)


def test_stale_scene_unlocks(page, base, sid) -> None:
    """A call left open when the week moves on: Finish re-reads the board, finds the call gone, drops the
    scene and the Recruit menu works again."""
    wait_week(base, sid)
    n = draws(page)
    page.click("#rc-finish")
    settle(page, n)
    assert not page.query_selector("#rc-finish"), "a lapsed call leaves the head"
    assert not page.query_selector(".go-pane .go-scene"), "a lapsed call plays no scene"
    page.click("#rc-recruit")
    page.wait_for_selector(".go-menu")
    whys = page.eval_on_selector_all(".go-menu .go-menu-item .go-menu-why", "els => els.map(e => e.textContent)")
    assert "Finish your call first" not in whys, whys
    page.keyboard.press("Escape")


def open_tab(page, base, sid, tab, wait):
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#season:visible")
    page.click(f"#season-tabs button[data-tab={tab}]")
    page.wait_for_selector(wait, timeout=120_000)
    time.sleep(0.8)


# the ladder "Sort: your chance" follows: yours, favorite, not offered while leading his list, in it, long shot,
# not offered elsewhere on (or off) his list, lost
LADDER = {"Yours": 0, "Favorite": 1, ("Not Offered", "warn"): 2, "In It": 3, "Long Shot": 4, ("Not Offered", "muted"): 5, "Lost": 6}


def ladder_of(sd: dict) -> int:
    return LADDER[(sd["word"], sd["tone"])] if sd["word"] == "Not Offered" else LADDER[sd["word"]]


def assert_chance_order(page, board: list, me: str) -> None:
    """The rows on screen, sorted by your chance, climb the ladder without a step back; within a rung the fuller bar first."""
    shown = page.eval_on_selector_all(".go-row-recruit", "els => els.map(e => e.dataset.pid)")
    by = {b["id"]: b for b in board}
    sds = page.evaluate("([rows, me]) => rows.map(b => window.CFP.recruiting.standingOf(b, me))", [[by[x] for x in shown], me])
    keys = [(ladder_of(sd), -(sd.get("fill") or 0)) for sd in sds]
    assert keys == sorted(keys), f"the board sorted by your chance breaks the ladder: {list(zip(shown, [sd['word'] for sd in sds]))}"


PITCH = {"proximity": "Close to Home", "playing_time": "Playing Time", "prestige": "Program Prestige", "winning": "Winning Now",
         "nil": "NIL", "coach": "The Head Coach", "academics": "Academics"}
REACTION = {"hit": "He lit up", "polite": "Polite", "quiet": "He went quiet", "tired": "He is tired of this"}
GONE = "heard".title()     # the word the cue tag used to print: the page never shows it now
HISTORY_EMPTY = "Nothing with him yet: no contact, no offer."
CUE_TITLE = "He brought this up on the call this week"


NULL_TEXT = "() => { const w = document.createTreeWalker(document.querySelector('.go-pane'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.nodeValue.trim() === 'null') return true; return false; }"


def check_pane_profile(page, base, sid) -> None:
    """The pane's Profile sub-tab on a scouted recruit, at 1280 (short window, so the pane scrolls inside itself) and
    400 (the full-screen sheet): no second head, no "null", every grade card inside the pane, and the sub-tab strip
    pinned in view, never clipped, after the body scrolls 600 px."""
    board = call(base, f"/api/season/{sid}/recruiting")["board"]
    scouted = next((b for b in board if (b.get("looks") or 0) >= 3 and b.get("our_grades")), None)
    if not scouted:         # the prospect the Prospects step scouted three times goes on the board (no hours)
        rows = call(base, f"/api/season/{sid}/prospects?limit=5000")["rows"]
        pick = next(r for r in rows if (r.get("looks") or 0) >= 3)
        call(base, f"/api/season/{sid}/board", {"pid": pick["id"], "on": True})
        scouted = next(b for b in call(base, f"/api/season/{sid}/recruiting")["board"] if b["id"] == pick["id"])
    assert scouted.get("our_grades"), f"a scouted recruit carries his grades: {scouted['id']}"
    for width, height in ((1280, 640), (400, 640)):     # short windows: the pane's body has room to scroll
        page.set_viewport_size({"width": width, "height": height})
        open_tab(page, base, sid, "recruiting", ".go-stages")
        if width > 700:     # a long board under the pane: scroll the page until the pane sticks
            page.evaluate("() => window.scrollTo(0, 1500)")
        page.click(f".go-row-recruit[data-pid='{scouted['id']}']")
        time.sleep(0.6)
        page.click(".go-pane .go-subtabs button[data-sub=profile]")
        page.wait_for_selector(".go-pane .go-sub-body.go-profile .go-grades .go-stat", timeout=60_000)
        page.mouse.move(2, height - 2)      # the pointer off the grade cards: no "looks like" box over the screenshots
        time.sleep(0.4)
        assert not page.query_selector(".go-pane .go-profile-head, .go-pane .go-sub-body h2.go-display"), f"the pane's Profile repeats his head at {width}"
        assert not page.evaluate(NULL_TEXT), f"a text node reads null in the pane at {width}"
        cards = page.evaluate("""() => { const pr = document.querySelector('.go-pane').getBoundingClientRect();
          return [...document.querySelectorAll('.go-pane .go-grades .go-stat')].map(c => { const r = c.getBoundingClientRect();
            const inner = Math.max(...[...c.querySelectorAll('.go-kicker, .go-stat-val, .go-word')].map(e => e.getBoundingClientRect().right));
            return [c.textContent.slice(0, 24), r.right <= pr.right + 0.5, inner <= r.right + 0.5]; }); }""")
        assert cards and all(c[1] and c[2] for c in cards), f"a grade card (or its words) runs past the pane at {width}: {cards}"
        shot(page, f"pane-profile-{width}-dark")
        t0 = page.evaluate("() => document.querySelector('.go-pane .go-subtabs').getBoundingClientRect().top")
        page.evaluate("() => { document.querySelector('.go-pane').scrollTop += 600; }")
        time.sleep(0.4)
        tabs = page.evaluate("""() => { const p = document.querySelector('.go-pane'), pr = p.getBoundingClientRect(), t = p.querySelector('.go-subtabs').getBoundingClientRect();
          const head = p.classList.contains('sheet') ? p.querySelector('.go-pane-head').getBoundingClientRect().bottom : pr.top;
          return { scrolled: p.scrollTop, top: t.top, bottom: t.bottom, height: t.height, visTop: Math.max(pr.top, 0, head), paneBottom: pr.bottom, left: t.left >= pr.left - 0.5, right: t.right <= pr.right + 0.5 }; }""")
        assert tabs["scrolled"] > 100, f"the pane's body scrolls at {width}: {tabs}"
        assert tabs["top"] >= tabs["visTop"] - 1 and tabs["bottom"] <= tabs["paneBottom"] and tabs["height"] >= 36 and tabs["left"] and tabs["right"], \
            f"the sub-tab strip scrolled away or clipped at {width}: {tabs}"
        if tabs["scrolled"] >= t0 - tabs["visTop"] + 4:   # the body scrolled far enough for the strip's place to pass the top: it pins there
            assert t0 - tabs["scrolled"] < tabs["visTop"] - 4, f"the check scrolls the strip's place out of view at {width}: {t0}, {tabs}"
            assert tabs["top"] <= tabs["visTop"] + 4, f"the sub-tab strip pins to the top of the pane's scroll box at {width}: {tabs}"
        else:               # a short profile (no evaluation, one-line grades) has less than that to scroll: the strip rides at its place, still in view
            # its place, or the top of the scroll box once its place has reached it (a profile that scrolls right up to the pin line)
            assert abs(tabs["top"] - max(t0 - tabs["scrolled"], tabs["visTop"])) <= 4, f"the sub-tab strip sits at its place in a short profile at {width}: {t0}, {tabs}"
        shot(page, f"pane-profile-scrolled-{width}-dark")
        if width <= 700:
            page.click(".go-pane .go-pane-back")
    page.set_viewport_size({"width": 1280, "height": 1000})

# ----- the Recruiting page batch (pg-recruiting): pester tags, the recruit question block, the portal NIL title -----

def wait_server(base: str) -> None:
    for _ in range(120):
        try:
            urllib.request.urlopen(base + "/api/teams", timeout=2)
            return
        except OSError:
            time.sleep(0.5)


def test_pester_tags(page, base) -> None:
    """A prospect you have pestered (three contacts landed while he is not considering you): the pane tags him
    "Tuning you out", a warning sits above the Recruit button, the menu's Message, Call and HC visit stay enabled with
    the cost in their titles, and a message to him still patches the pane in place with its toast and a History line."""
    from coach_career import recruiting
    from sim import season
    from test_pester import far_prospect
    me = "ohio-state"
    st = season.new_season(me, "full", seed=11, career=True)
    rc = st["recruiting"]
    recruiting.weekly_step(st, 0)                       # the AI schools' first week fills his list
    pid = far_prospect(st)
    name = rc["prospects"][pid]["name"]
    rc["contacts"].setdefault(pid, {})[me] = {"n": recruiting.PESTER_FREE, "hc_week": None}   # the free contacts are spent
    st["current_week"] = 1
    season.save_season(st)
    sid = st["id"]
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    try:
        call(base, f"/api/season/{sid}/board", {"pid": pid, "on": True})
        b = next(x for x in call(base, f"/api/season/{sid}/recruiting")["board"] if x["id"] == pid)
        assert b["pestering"] is True and b["pesters"] == 0, b
        open_tab(page, base, sid, "recruiting", ".go-stages")
        page.click(f".go-row-recruit[data-pid='{pid}']")
        page.wait_for_selector(".go-pane .go-tags .go-tag:has-text('Tuning You Out')", timeout=30_000)
        tag = page.query_selector(".go-pane .go-tags .go-tag:has-text('Tuning You Out')")
        assert "bad" in (tag.get_attribute("class") or ""), tag.get_attribute("class")
        assert tag.get_attribute("title") == "He is not considering you; more contact pushes him away"
        warn = page.query_selector(".go-pane .go-warn[role=note]")
        assert warn and warn.inner_text().strip() == "He is tuning you out: another contact costs you interest.", warn and warn.inner_text()
        assert page.evaluate("() => { const w = document.querySelector('.go-pane .go-warn'), r = document.querySelector('#rc-recruit'); return w.getBoundingClientRect().bottom <= r.getBoundingClientRect().top + 1; }"), "the warning sits above the Recruit button"
        page.click("#rc-recruit")
        page.wait_for_selector(".go-menu")
        items = page.evaluate("() => Object.fromEntries([...document.querySelectorAll('.go-menu .go-menu-item')].map(e => [e.dataset.action, [e.getAttribute('title'), e.getAttribute('aria-disabled')]]))")
        for a in ("message", "call", "hc_visit"):
            assert items[a] == ["Costs you interest while he is tuning you out", None], (a, items[a])
        for a in ("scout", "offer", "off_board"):
            assert items[a][0] is None, (a, items[a])
        page.click(".go-menu .go-menu-item[data-action=message]")
        page.wait_for_selector(".go-pane .go-step select#rc-pitch")
        h = watch(page, ".go-pane", ".go-pane .go-step button.go-step-go", scrolled=False)
        n = draws(page)
        page.click(".go-pane .go-step button.go-step-go")
        toasted(page, f"Message sent to {name} · 5 hours")
        settle(page, n)
        smooth(page, h, "Message to a prospect who is tuning you out")
        assert page.query_selector(".go-pane .go-tags .go-tag:has-text('Tuning You Out')"), "the tag stays after the pester"
        assert page.query_selector(".go-pane .go-warn[role=note]"), "the warning stays after the pester"
        page.click(".go-subtabs button[data-sub=history]")
        time.sleep(0.4)
        hist = page.inner_text(".go-pane .go-sub-body")
        assert "Week 1 · He tuned out your message" in hist, hist
        assert not errs, errs
    finally:
        call(base, f"/api/season/{sid}", method="DELETE")


def test_recruit_question(page) -> None:
    """A call on which he asks about a named player (its own dev server, CFP_QUESTION_RATE=1): the question block
    with his line and three answers, the pitch locked until you answer, a straight answer's reply unlocking it in
    place with no toast, the answered question kept through Hang up and Finish, and the History line."""
    from coach_career import scenes
    from sim import season
    st = season.new_season("smu", "full", seed=62, career=True)
    me, rc, week = st["team"], st["recruiting"], st["current_week"]
    rate = scenes.QUESTION_RATE
    scenes.QUESTION_RATE = 1.0
    try:
        pid = next(q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
                   if not rc["prospects"][q].get("hidden") and rc["status"][q]["committed"] is None
                   and "playing_time" in rc["prospects"][q]["priorities"] and scenes.question(st, me, q, week))
    finally:
        scenes.QUESTION_RATE = rate
    season.save_season(st)
    sid = st["id"]
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port), "CFP_QUESTION_RATE": "1"},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    try:
        wait_server(base)
        call(base, f"/api/season/{sid}/board", {"pid": pid, "on": True})
        open_tab(page, base, sid, "recruiting", ".go-stages")
        page.click(f".go-row-recruit[data-pid='{pid}']")
        time.sleep(0.4)
        page.click("#rc-recruit")
        page.wait_for_selector(".go-menu")
        page.click(".go-menu .go-menu-item[data-action=call]")
        present_three(page)
        page.wait_for_selector(".go-pane .go-scene .go-question", timeout=30_000)
        b = next(x for x in call(base, f"/api/season/{sid}/recruiting")["board"] if x["id"] == pid)
        q = b["scene"]["question"]
        assert q and q["answer"] is None, q
        block = page.inner_text(".go-pane .go-scene .go-question")
        assert q["text"] in block and b["name"] in block, (block, q)
        # each answer button: a Title Case label over the line you say (the line kept word for word)
        answers = page.evaluate("() => [...document.querySelectorAll('.go-pane .go-scene .go-answer')].map(e => [e.dataset.answer, e.querySelector('.go-answer-label').textContent.trim(), e.querySelector('.go-answer-line').textContent.trim()])")
        assert answers == [[k, scenes.ANSWER_LABELS[k], scenes.ANSWER_COPY[q["kind"]][k]] for k in ("straight", "promise", "deflect")], answers
        pitch = ".go-pane .go-scene .go-scene-acts button:has-text('Pitch')"
        assert page.is_disabled(pitch) and page.get_attribute(pitch, "title") == "Answer him first"
        assert page.evaluate("() => [...document.querySelectorAll('.go-pane .go-scene .go-pitches input')].every(r => r.disabled)"), "the pitch radios wait on the answer"
        h = watch(page, ".go-pane .go-scene", ".go-pane .go-scene .go-answer[data-answer=straight]", scrolled=False)
        toasts = page.evaluate("() => document.querySelectorAll('#toasts .toast-item').length")
        page.click(".go-pane .go-scene .go-answer[data-answer=straight]")
        page.wait_for_selector(".go-pane .go-scene .go-question-reply", timeout=30_000)
        page.wait_for_selector(".go-pane .go-scene .go-answer", state="detached", timeout=10_000)
        reply = page.query_selector(".go-pane .go-scene .go-question-reply")
        assert reply.inner_text().strip() == scenes.REPLY_LINES["straight"], reply.inner_text()
        assert "good" in (reply.get_attribute("class") or ""), reply.get_attribute("class")
        smooth(page, h, "Answering his question")
        assert not page.is_disabled(pitch) and not page.get_attribute(pitch, "title") == "Answer him first", "the pitch unlocks"
        assert page.evaluate("() => [...document.querySelectorAll('.go-pane .go-scene .go-pitches input')].every(r => !r.disabled)")
        assert page.evaluate("() => document.querySelectorAll('#toasts .toast-item').length") == toasts, "the reply is the feedback: no toast"
        # Hang up, then Finish: the answered question comes back without its buttons
        page.click(".go-pane .go-scene button:has-text('Hang Up')")
        page.wait_for_selector("#rc-finish")
        n = draws(page)
        page.click("#rc-finish")
        settle(page, n)
        page.wait_for_selector(".go-pane .go-scene .go-question-reply", timeout=30_000)
        assert not page.query_selector(".go-pane .go-scene .go-answer"), "an answered question offers no answers"
        assert q["text"] in page.inner_text(".go-pane .go-scene .go-question")
        assert not page.is_disabled(pitch)
        page.click(pitch)
        page.wait_for_selector(".go-pane .go-reaction", timeout=30_000)
        page.click(".go-subtabs button[data-sub=history]")
        page.wait_for_function("(t) => (document.querySelector('.go-pane .go-sub-body') || {}).textContent.includes(t)",
                               arg=f"Told him straight about {q['about']['name']}", timeout=30_000)
        assert not errs, errs
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()


def test_portal_nil_title(page, base, sid) -> None:
    """The portal board's title carries the NIL pool (the API's nil.pool), and its meter reads against the pool."""
    v = call(base, f"/api/season/{sid}/recruiting")
    assert v["portal"] and v["nil"]["pool"] is not None, v["nil"]
    page.wait_for_selector("#tab-offseason .rc-head .go-display", timeout=30_000)
    title = page.inner_text("#tab-offseason .rc-head .go-display").strip()
    assert title == f"TRANSFER PORTAL · WEEK {v['portal']['week']} OF {v['portal']['weeks']} · {v['nil']['pool']} NIL", title
    assert f"{v['nil']['left']} / {v['nil']['pool']}" in page.inner_text("#tab-offseason .rc-head .go-meters")


# ----- the Scouting tab (web/scouting.js): the scouts, the queue, the reports and the flags -----

SCOUT_HOURS = 5


def test_scouting_tab(page, base, sid) -> None:
    """The Scouting tab (the redesign): every scout listed in the compact My scouts list, the DC included; the area
    dropdown posts and toasts; the board filter shows only board rows, each marked; Send patches the row in place
    with the inline result and the toast, never rebuilding the table; pagination moves to page 2 and back; the RANK
    header sorts both ways; a report name opens the board's pane on him and the pane links back to the reports; on
    a phone the two top panels stack and the table scrolls sideways inside its card, never the page."""
    wait_week(base, sid)        # a new week's hours, and a fresh week of looks for the reports
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#season:visible")
    assert not page.query_selector("#season-tabs button[data-tab=staff]") and not page.query_selector("#tab-staff"), "the Staff tab is gone"
    open_tab(page, base, sid, "scouting", ".sc-table .sc-row")
    for block in (".sc-block-scouts .sc-scout", ".sc-reports .go-subtabs", ".sc-queue-panel .sc-table thead", ".sc-pager"):
        assert page.query_selector(block), f"the Scouting tab draws {block}"
    assert not page.query_selector(".sc-queue, .rc-staff-card"), "the old queue list and the big scout cards are gone"
    text = page.inner_text("#tab-scouting")
    assert "null" not in text.split() and not OUT_OF_100.search(text), text[:200]
    # every staff member has a row (the old grid dropped two of five), the DC among them
    v = call(base, f"/api/season/{sid}/scouting")
    rows = page.eval_on_selector_all(".sc-block-scouts .sc-scout", "els => els.map(e => e.textContent)")
    assert len(rows) == len(v["scouts"]) == 5, (len(rows), len(v["scouts"]))
    dc = next(m for m in v["scouts"] if m["role"] == "Defensive Coordinator")
    assert any(dc["name"] in r and "DC" in r for r in rows), f"the Defensive coordinator {dc['name']} is listed with his role word"
    assert all(page.query_selector(f".sc-scout[data-key='{m['id']}'] .sc-bar") for m in v["scouts"]), "each scout carries his narrowed-this-week bar"
    # the area dropdown: posts to /staff and toasts
    scout = v["scouts"][0]
    sel = f"#area-{scout['id']}"
    options = page.eval_on_selector_all(f"{sel} option", "els => els.map(e => e.value)")
    other = next(a for a in options if a and a != scout["area"])
    page.select_option(sel, other)
    toasted(page, f"{scout['name']} now scouts {other}.")
    assert next(m for m in call(base, f"/api/season/{sid}/recruiting")["staff"] if m["id"] == scout["id"])["area"] == other
    page.wait_for_function("([sel, a]) => document.querySelector(sel).value === a", arg=[sel, other], timeout=10_000)
    assert page.evaluate("() => document.querySelectorAll('.sc-block-scouts .sc-scout').length") == 5, "the list keeps every scout after a change"
    # the board filter: only board rows, each with the mark and the accent
    board = {b["id"] for b in call(base, f"/api/season/{sid}/recruiting")["board"]}
    on_board = [r["pid"] for r in call(base, f"/api/season/{sid}/scouting?limit=400")["queue"] if r["pid"] in board]
    assert on_board, "the board has recruits worth a trip"
    page.click(".sc-chips .go-chip[data-board=on]")
    page.wait_for_function("(n) => document.querySelector('.sc-chips .go-chip[data-board=on]').getAttribute('aria-pressed') === 'true' && !document.querySelector('.sc-table-wrap[aria-busy]') && document.querySelector('.sc-showing').textContent.endsWith(`of ${n}`)",
                           arg=len(on_board), timeout=15_000)
    assert page.evaluate("() => document.querySelectorAll('.sc-table .sc-row:not(.go-leaving)').length") == min(len(on_board), 25)
    marks = page.eval_on_selector_all(".sc-table .sc-row:not(.go-leaving)", "els => els.map(e => [e.dataset.pid, e.classList.contains('on-board'), !!e.querySelector('.sc-board-mark')])")
    assert all(pid in board and on and mark for pid, on, mark in marks), marks[:3]
    page.click(".sc-chips .go-chip[data-board=all]")
    page.wait_for_function("() => !document.querySelector('.sc-table-wrap[aria-busy]') && document.querySelector('.sc-showing').textContent.startsWith('Showing 1 to 25 of') && document.querySelectorAll('.sc-table .sc-row:not(.go-leaving)').length === 25", timeout=15_000)
    marks = page.eval_on_selector_all(".sc-table .sc-row:not(.go-leaving)", "els => els.map(e => [e.dataset.pid, e.classList.contains('on-board')])")
    assert all(on == (pid in board) for pid, on in marks), "All: the board rows carry the accent, the rest do not"
    assert len(on_board) >= 25 or any(not on for _, on in marks), "All: the class follows the board"
    # Send: the row patches in place (the table body stays), the result reads inline under him, the toast names the look
    v = call(base, f"/api/season/{sid}/scouting")
    assert v["hours_left"] >= SCOUT_HOURS, "a new week has hours for a trip"
    row = next(r for r in v["queue"] if r["can_send"])
    pid = row["pid"]
    # looks come in trip units: the LOOKS bar is three segments filled in halves ("1.5 of 3"), a Send adds one
    fmt = lambda n: str(int(n)) if float(n) == int(n) else f"{n:.1f}"
    segments = lambda: page.evaluate("(pid) => [...document.querySelectorAll(`.sc-row[data-pid='${pid}'] .sc-trip`)].map(t => t.classList.contains('on') ? 1 : t.classList.contains('half') ? 0.5 : 0)", pid)
    before = row["looks"] or 0
    assert segments() == [min(1, max(0, before - i)) for i in range(3)], (before, segments())
    assert page.inner_text(f".sc-row[data-pid='{pid}'] .sc-looks-text") == f"{fmt(before)} of 3"
    assert "trips" not in page.inner_text(f".sc-row[data-pid='{pid}'] .sc-c-looks"), "no separate trips count"
    assert page.inner_text(f".sc-row[data-pid='{pid}'] .sc-send") == ("Send (5h) · Finishes His Report" if 3 - before <= 1 else "Send (5h)")
    after = min(3, before + 1)
    h = watch(page, ".sc-table tbody", control=f".sc-row[data-pid='{pid}'] .sc-send", scrolled=False)
    page.click(f".sc-row[data-pid='{pid}'] .sc-send")
    toasted(page, f"Scouted {row['name']} · {fmt(after)} of 3 looks" + (" · his report is complete" if after >= 3 else ""))
    smooth(page, h, "Send")
    page.wait_for_selector(f".sc-result-row[data-key='{pid}:result'] .sc-result", timeout=10_000)
    assert page.evaluate("(pid) => { const r = document.querySelector(`.sc-row[data-pid='${pid}']`); return r && r.nextElementSibling && r.nextElementSibling.classList.contains('sc-result-row'); }", pid), "the result sits right under his row"
    assert segments() == [min(1, max(0, after - i)) for i in range(3)], "his LOOKS bar fills one more segment, in halves"
    assert page.inner_text(f".sc-row[data-pid='{pid}'] .sc-looks-text") == f"{fmt(after)} of 3"
    # a report one Send from complete says so on its button; the Send that completes it leaves a Complete tag where Send was
    while after < 3 and call(base, f"/api/season/{sid}/scouting")["hours_left"] >= SCOUT_HOURS:
        page.wait_for_function("(pid) => { const b = document.querySelector(`.sc-row[data-pid='${pid}'] .sc-send`); return b && !b.disabled && !b.classList.contains('go-busy'); }", arg=pid, timeout=15_000)
        assert page.inner_text(f".sc-row[data-pid='{pid}'] .sc-send") == ("Send (5h) · Finishes His Report" if 3 - after <= 1 else "Send (5h)"), page.inner_text(f".sc-row[data-pid='{pid}'] .sc-send")
        page.click(f".sc-row[data-pid='{pid}'] .sc-send")
        after = min(3, after + 1)
        toasted(page, f"Scouted {row['name']} · {fmt(after)} of 3 looks" + (" · his report is complete" if after >= 3 else ""))
    if after >= 3:
        page.wait_for_function("(pid) => { const r = document.querySelector(`.sc-row[data-pid='${pid}']`); return r && !r.querySelector('.sc-complete').hidden && r.querySelector('.sc-send').hidden; }", arg=pid, timeout=15_000)
        assert page.eval_on_selector(f".sc-row[data-pid='{pid}'] .sc-complete", "e => e.textContent") == "Complete", "the tag reads Complete (the tag style sets it in capitals)"
        assert segments() == [1, 1, 1], segments()
        assert not page.is_visible(f".sc-row[data-pid='{pid}'] .sc-send"), "a complete report shows the tag instead of Send"
        on_board = pid in {b["id"] for b in call(base, f"/api/season/{sid}/recruiting")["board"]}
        kept = next((r for r in call(base, f"/api/season/{sid}/scouting?limit=400")["queue"] if r["pid"] == pid), None)
        assert (kept is not None) == on_board, "a complete report stays in the queue only while he is on your board"
        if kept:
            assert kept["can_send"] is False and kept["why"] == "His report is complete: 3 of 3 looks" and kept["potential"][0] == kept["potential"][1], kept
        assert page.evaluate("(el) => el.isConnected", h), "the table body was never rebuilt by the completing Send"
    left = call(base, f"/api/season/{sid}/scouting")["hours_left"]
    assert f"{left} of" in page.inner_text("#sc-hours"), (left, page.inner_text("#sc-hours"))
    assert page.evaluate("(el) => el.isConnected", h), "the table body was never rebuilt"
    if after >= 3:      # his kept row makes 26 on the page: reopen the tab (a render on tab open draws in full) before paging
        open_tab(page, base, sid, "scouting", ".sc-table .sc-row")
        h = watch(page, ".sc-table tbody", scrolled=False)
    # pagination: page 2 and back
    total = call(base, f"/api/season/{sid}/scouting")["queue_total"]
    assert total > 50, total
    first = page.eval_on_selector_all(".sc-table .sc-row:not(.go-leaving)", "els => els.map(e => e.dataset.pid)")
    assert "Showing 1 to 25 of" in page.inner_text(".sc-showing"), page.inner_text(".sc-showing")
    assert page.get_attribute(".sc-pager .sc-page[aria-current=page]", "data-page") == "1"
    page.click(".sc-pager .sc-next")
    page.wait_for_function("() => document.querySelector('.sc-showing').textContent.startsWith('Showing 26 to 50')", timeout=15_000)
    second = page.eval_on_selector_all(".sc-table .sc-row:not(.go-leaving)", "els => els.map(e => e.dataset.pid)")
    assert second and not set(second) & set(first), "page 2 holds other recruits"
    assert page.get_attribute(".sc-pager .sc-page[aria-current=page]", "data-page") == "2"
    assert page.eval_on_selector_all(".sc-pager .sc-page", "els => els.map(e => e.textContent.trim())")[-1] == f"{-(-total // 25)}", "the last page is listed"
    page.click(".sc-pager .sc-prev")
    page.wait_for_function("() => document.querySelector('.sc-showing').textContent.startsWith('Showing 1 to 25')", timeout=15_000)
    assert page.eval_on_selector_all(".sc-table .sc-row:not(.go-leaving)", "els => els.map(e => e.dataset.pid)") == first
    # sorting by RANK toggles the order (client-side, on the page shown)
    ranks = lambda: page.eval_on_selector_all(".sc-table .sc-row:not(.go-leaving) .sc-rank", "els => els.map(e => +e.textContent.replace('#', ''))")
    page.click(".sc-table th .sc-sort[data-sort=rank]")
    time.sleep(0.4)
    assert page.get_attribute(".sc-table th:has(.sc-sort[data-sort=rank])", "aria-sort") == "ascending"
    asc = ranks()
    assert asc == sorted(asc), asc
    page.click(".sc-table th .sc-sort[data-sort=rank]")
    time.sleep(0.4)
    assert page.get_attribute(".sc-table th:has(.sc-sort[data-sort=rank])", "aria-sort") == "descending"
    assert ranks() == sorted(asc, reverse=True)
    assert page.evaluate("(el) => el.isConnected", h), "sorting reorders the rows, it does not rebuild the table"
    # a report name opens the board's pane on him, a recruit off your board included; the tab is reopened first so
    # its reports hold the trip just sent
    open_tab(page, base, sid, "scouting", ".sc-reports .go-subtabs")
    assert page.get_attribute(".sc-reports .go-subtabs button[data-week=this_week]", "aria-selected") == "true"
    v = call(base, f"/api/season/{sid}/scouting")
    board = {b["id"] for b in call(base, f"/api/season/{sid}/recruiting")["board"]}
    items = [it for g in v["reports"]["this_week"] for it in g["items"]]
    if not items:
        page.click(".sc-reports .go-subtabs button[data-week=flags]")
        items = [{"pid": f["pid"], "name": f["name"]} for f in v["flags"]]
    assert items, "a week of looks leaves something to report"
    item = next((it for it in items if it["pid"] not in board), items[0])
    if page.query_selector(".sc-reports .sc-report-more"):
        for b in page.query_selector_all(".sc-reports .sc-report-more"):
            b.click()
    page.click(f".sc-reports .go-link[data-pid='{item['pid']}']")
    page.wait_for_selector(".go-pane .go-pane-name", timeout=60_000)
    assert item["name"] in page.inner_text(".go-pane .go-pane-head"), "the pane opens on him"
    assert item["pid"] in {b["id"] for b in call(base, f"/api/season/{sid}/recruiting")["board"]}
    # the pane's Scouting sub-tab links back to the tab, on the Reports panel's This week
    page.click(".go-pane .go-subtabs button[data-sub=scouting]")
    page.wait_for_selector(".go-pane .go-sub-body .sc-reports-link", timeout=30_000)
    assert page.inner_text(".go-pane .go-sub-body .sc-reports-link").strip() == "Reports on the Scouting Tab"
    page.click(".go-pane .go-sub-body .sc-reports-link")
    page.wait_for_selector("#tab-scouting:visible .sc-table", timeout=60_000)
    assert page.get_attribute(".sc-reports .go-subtabs button[data-week=this_week]", "aria-selected") == "true"
    # Last week and Flags
    page.click(".sc-reports .go-subtabs button[data-week=last_week]")
    time.sleep(0.4)
    assert page.get_attribute(".sc-reports .go-subtabs button[data-week=last_week]", "aria-selected") == "true"
    assert page.query_selector(".sc-reports .sc-report") or page.query_selector(".sc-reports .sc-reports-empty")
    page.click(".sc-reports .go-subtabs button[data-week=flags]")
    time.sleep(0.4)
    assert page.query_selector(".sc-reports .sc-flag") or page.query_selector(".sc-reports .sc-flags-empty")
    # a phone: the two top panels stack, the table scrolls sideways inside its card, no sideways page scroll
    page.set_viewport_size({"width": 400, "height": 860})
    open_tab(page, base, sid, "scouting", ".sc-table .sc-row")
    assert page.evaluate("() => getComputedStyle(document.querySelector('.sc-table-wrap')).overflowX") == "auto"
    assert page.evaluate("() => { const w = document.querySelector('.sc-table-wrap'); return w.scrollWidth > w.clientWidth + 1; }"), "the table is wider than its card and scrolls inside it"
    assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways scroll on a phone"
    assert page.evaluate("() => { const a = document.querySelector('.sc-block-scouts').getBoundingClientRect(), b = document.querySelector('.sc-reports').getBoundingClientRect(); return a.bottom <= b.top + 1; }"), "the two top panels stack"
    clipped = not_clipped(page, ".sc-scout .sc-scout-name")
    assert not clipped, clipped[:3]
    page.set_viewport_size({"width": 1280, "height": 1000})


# ----- the compact header (compact-header brief), the Office as the only place time moves -----

def check_header(page, base, sid) -> None:
    """No season open: the toolbar shows New season and Load career. A season open: they fold into Seasons ▾, whose
    menu lists the seasons and starts a new career end to end; the header card keeps no time-moving control (the
    Office's play card holds Sim the week, Game day, Sim to selection day, Sim to signing day and the week picker);
    past the card a sticky bar shows the record and an Office button and the pane's --sticky-top grows by it; at
    400 px the bar is the default and its ▾ opens the header row; the tabs are one row."""
    page.set_viewport_size({"width": 1280, "height": 1000})
    page.goto(f"{base}/index.html")
    page.wait_for_selector("#btn-new:visible")
    assert page.is_visible("#btn-load-career") and not page.is_visible("#btn-seasons-menu"), "no season open: the full toolbar"
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#season:visible")
    time.sleep(0.6)
    assert page.is_visible("#btn-seasons-menu"), "a season open: the Seasons menu button"
    for sel in ("#btn-new", "#btn-load-career", "#btn-seasons", "#pick-team"):
        assert not page.is_visible(sel), f"{sel} shows with a season open"
    assert not page.query_selector("#btn-advance, #btn-to-end, #btn-to-selection, #advance-to, #btn-gameday"), "the header keeps no time-moving control"
    assert page.is_visible("#btn-settings") and page.is_visible("#btn-download-career"), "Settings and Download career stay in the header"
    # the Office's play card
    s = call(base, f"/api/season/{sid}")
    page.click("#season-tabs button[data-tab=office]")
    page.wait_for_selector(".go-play [data-play=advance]", timeout=60_000)
    labels = page.eval_on_selector_all("#tab-office .go-play button", "els => els.map(e => e.textContent.trim())")
    assert labels[0] == "Sim the Week", labels
    assert "Sim to Selection Day" in labels and "Sim to Signing Day" in labels and "▾" in labels, labels
    nxt = next((g for g in s["schedule"] if g["week"] == s["current_week"] + 1 and g.get("opponent")), None)
    assert any(l.startswith("Game Day") for l in labels) == bool(nxt and not nxt["played"]), labels
    page.click("#tab-office .go-play .go-play-more")
    page.wait_for_selector(".go-menu .go-menu-item")
    weeks = page.eval_on_selector_all(".go-menu .go-menu-item b", "els => els.map(e => e.textContent)")
    assert len(weeks) == 20 - (s["current_week"] + 2) + 1 and weeks[-1] == "National Championship", weeks
    page.keyboard.press("Escape")
    assert not page.query_selector(".go-menu"), "Escape closes the week picker"
    assert page.evaluate("() => document.activeElement === document.querySelector('.go-play-more')"), "the focus returns to ▾"
    # one tab row
    assert page.evaluate("() => document.querySelectorAll('#season-tabs .tab-row').length") == 1, "one tab row"
    assert page.evaluate("() => document.querySelectorAll('#season > nav.tabs').length") == 1, "one tab bar"
    assert page.evaluate("() => document.querySelectorAll('#season-tabs button[data-tab]').length") == 16, "every tab of the old two rows"
    assert page.evaluate("() => document.querySelectorAll('#season-tabs .tab-divider').length") == 1
    # the Seasons menu: the seasons, New season end to end
    page.click("#btn-seasons-menu")
    page.wait_for_selector(".season-menu .go-menu-item")
    names = page.eval_on_selector_all(".season-menu .go-menu-item b", "els => els.map(e => e.textContent)")
    assert any(s["team_name"] in n for n in names) and "New Season" in names and "Load Career" in names and "Clear All" in names, names
    assert page.get_attribute("#btn-seasons-menu", "aria-expanded") == "true"
    page.click(".season-menu .go-menu-item:has-text('New season')")
    page.wait_for_selector(".start-pick select")
    page.select_option(".start-pick select", "akron")
    page.click(".start-pick button.accent")
    page.wait_for_selector(".start-card button.accent", timeout=60_000)
    page.click(".start-card button.accent")
    page.wait_for_function("(id) => { const q = new URLSearchParams(location.search).get('id'); return q && q !== id && !document.querySelector('#season').hidden; }", arg=sid, timeout=180_000)
    new_id = page.evaluate("() => new URLSearchParams(location.search).get('id')")
    assert call(base, f"/api/season/{new_id}")["team"] == "akron", "the new career from the menu is Akron's"
    assert "AKRON" in page.inner_text("#season-title").upper()
    call(base, f"/api/season/{new_id}", method="DELETE")
    # past the header card: the compact bar, the pane below it
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#season:visible")
    page.click("#season-tabs button[data-tab=stats]")        # a long page: it scrolls well past the header
    page.wait_for_selector("#tab-stats .leader-row", timeout=60_000)
    assert not page.is_visible("#season-compact"), "at the top the full card shows, no bar"
    sticky0 = page.evaluate("() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top'))")
    page.evaluate("() => window.scrollTo(0, 800)")
    page.wait_for_selector("#season-compact:visible", timeout=10_000)
    bar = page.inner_text("#season-compact")
    assert f"{s['record']['wins']}-{s['record']['losses']}" in bar and "up next" in bar, bar
    assert page.is_visible("#btn-compact-office") and page.is_visible("#btn-compact-more")
    time.sleep(0.3)
    sticky1 = page.evaluate("() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top'))")
    bar_h = page.evaluate("() => document.querySelector('#season-compact').getBoundingClientRect().height")
    top_h = page.evaluate("() => document.querySelector('.topbar').getBoundingClientRect().height")   # the top bar hid on the way down (check_topbar_hide)
    assert abs((sticky1 - sticky0) - (bar_h - top_h)) <= 2, (sticky0, sticky1, bar_h, top_h)
    page.click("#btn-compact-more")
    page.wait_for_selector(".go-menu .go-menu-item:has-text('Settings')")
    page.keyboard.press("Escape")
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_function("() => document.querySelector('#season-compact').hidden", timeout=10_000)
    # the Recruiting pane keeps below the bar
    page.click("#season-tabs button[data-tab=recruiting]")
    page.wait_for_selector(".go-row-recruit", timeout=60_000)
    page.click(".go-row-recruit >> nth=0")
    page.wait_for_selector(".go-pane", timeout=30_000)
    page.evaluate("() => window.scrollTo(0, 800)")
    time.sleep(0.5)
    if page.evaluate("() => window.scrollY") > 300:
        r = page.evaluate("() => ({ pane: document.querySelector('.go-pane').getBoundingClientRect().top, bar: document.querySelector('#season-compact').getBoundingClientRect().bottom, on: !document.querySelector('#season-compact').hidden })")
        assert r["on"] and r["pane"] >= r["bar"] - 1, r
    # the Office button in the bar opens the Office with the focus on Sim the week
    page.click("#btn-compact-office")
    page.wait_for_selector("#tab-office:visible .go-play")
    assert page.evaluate("() => document.activeElement && document.activeElement.dataset.play === 'advance'"), "Office: the focus lands on Sim the week"
    # a phone: the bar is the default; ▾ opens the header row as a sheet
    page.set_viewport_size({"width": 400, "height": 860})
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#season:visible")
    page.click("#season-tabs button[data-tab=schedule]")
    page.wait_for_selector(".schedule-pick", timeout=60_000)
    page.wait_for_selector("#season-compact:visible", timeout=10_000)
    assert not page.is_visible(".season-head-row"), "a phone folds the header row"
    page.click("#btn-compact-more")
    page.wait_for_selector(".season-head-row:visible", timeout=10_000)
    assert page.is_visible("#btn-settings")
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.body.classList.contains('head-sheet')")
    page.set_viewport_size({"width": 1280, "height": 1000})


# ----- position changes any time (pos-anytime brief, Part B): the Depth Chart's Position control -----

def check_position_change(page, base, sid) -> None:
    """From the depth chart screen a WR moves to TE through the Position box on his drawer: the screen patches in
    place (no rebuild of the field), his card sits at a TE spot (or in the TE row of the list) with "was WR", the
    toast says so, and the API agrees; the List view's rail carries the same box."""
    page.set_viewport_size({"width": 1280, "height": 1000})
    s = call(base, f"/api/season/{sid}")
    d = call(base, f"/api/season/{sid}/depth/{s['team']}")
    wr = next(row for u in d["units"] for row in u["rows"] if row["role"] == "WR")
    p = next(x for x in wr["players"][:3] if x["role"] == "WR" and not x.get("moved_from") and not x.get("injury"))   # a starting receiver: he is on the field
    open_tab(page, base, sid, "depth", ".dc-card")
    page.click(f".dc-card[data-slug='{p['slug']}']")
    sel = ".dc-drawer select.depth-pos"
    page.wait_for_selector(sel, timeout=30_000)
    h = watch(page, ".dc-field", control=sel, scrolled=False)
    page.hover(sel)
    page.wait_for_function("(q) => document.querySelector(q).options.length > 5", arg=sel, timeout=30_000)
    groups = page.eval_on_selector_all(f"{sel} optgroup", "els => els.map(e => e.label)")
    assert groups and "Tight Ends" in groups and "Kickers" not in groups, groups
    assert page.eval_on_selector(f"{sel} option", "o => o.textContent").startswith("WR"), "his position now comes first"
    page.select_option(sel, "TE")
    toasted(page, f"{p['name']} moves to TE (was WR)")
    page.wait_for_selector(f".dc-drawer .dc-was:has-text('was WR')", timeout=30_000)
    time.sleep(0.4)
    smooth(page, h, "a position change")
    dv = call(base, f"/api/season/{sid}/depth/{s['team']}")
    te = next(row for u in dv["units"] for row in u["rows"] if row["role"] == "TE")
    me = next(x for x in te["players"] if x["slug"] == p["slug"])
    assert me["moved_from"] == "WR" and me["role"] == "TE", me
    assert not any(x["slug"] == p["slug"] for x in next(row for u in dv["units"] for row in u["rows"] if row["role"] == "WR")["players"]), "he left the WR row"
    # the List view: his row in the TE list says where he came from, and the rail's box moves him back
    page.goto(f"{base}/index.html?id={sid}&screen=depth&view=list&role=TE")
    page.wait_for_selector(".dc-table tbody tr", timeout=120_000)
    row = f".dc-table tbody tr[data-slug='{p['slug']}']"
    page.wait_for_selector(row, timeout=30_000)
    assert page.eval_on_selector(f"{row} .dc-was", "e => e.textContent") == "was WR", page.inner_text(row)
    page.click(row)
    page.wait_for_function("(slug) => document.querySelector('.dc-rail select.depth-pos') && document.querySelector('.dc-rail').textContent.includes('was WR')", arg=p["slug"], timeout=30_000)
    rsel = ".dc-rail select.depth-pos"
    h = watch(page, ".dc-table", control=rsel, scrolled=False)
    page.hover(rsel)
    page.wait_for_function("(q) => document.querySelector(q).options.length > 5", arg=rsel, timeout=30_000)
    page.select_option(rsel, "WR")
    toasted(page, f"{p['name']} moves back to WR")
    page.wait_for_function("(q) => !document.querySelector(q)", arg=row, timeout=30_000)   # he left the TE list
    time.sleep(0.4)
    smooth(page, h, "a position change back")
    dv = call(base, f"/api/season/{sid}/depth/{s['team']}")
    me = next(x for u in dv["units"] for row in u["rows"] for x in row["players"] if x["slug"] == p["slug"] and row["role"] == "WR")
    assert not me.get("moved_from") and me["role"] == "WR", me


# ----- the NIL economy (nil-economy spec, section 3): the review's line reads the pool's math -----

def check_nil_review(page, base, sid) -> None:
    """At Departures the primary button reads "Advance to …" (compact-header brief, item 7) and the review's NIL line
    carries the pool's numbers as the API gives them."""
    assert page.evaluate("() => document.querySelector('#tab-offseason .go-btn.primary.big').textContent").startswith("Advance to"), "the primary button says where it goes"
    v = call(base, f"/api/season/{sid}/offseason")
    n = (v.get("review") or {}).get("nil_portal")
    assert n, "the offseason review carries the pool record"
    page.wait_for_selector("#tab-offseason .off-nil-line", timeout=30_000)
    text = page.inner_text("#tab-offseason .off-nil-line")
    assert text.startswith(f"NIL for the portal: {n['left']} left + {n['reward']} earned"), text
    assert f"= {n['left'] + n['reward']}" in text, text
    if n["pool"] == n["floor"] and n["pool"] > n["left"] + n["reward"]:
        assert f"raised to the {n['floor']} portal fund" in text, text
    else:
        assert "portal fund" not in text, text
    for why in n.get("reward_why") or []:
        assert why in text, (why, text)


# ----- the top bar hides while a season scrolls (topbar-hide brief) -----

def check_topbar_hide(page, base, sid) -> None:
    """A season open, past its own height the top bar slides up and the compact bar sits flush at the top;
    scrolling up 24 px, the pointer at the top edge, the focus inside it or the Seasons menu bring it back;
    the compact ▾ carries Seasons, Your coach and Theme (the Theme entry toggles data-theme); with no season
    open and on the Your coach page it never hides."""
    page.set_viewport_size({"width": 1280, "height": 1000})
    hidden = "() => document.querySelector('.topbar').classList.contains('topbar-hidden')"
    rects = """() => ({ bar: document.querySelector('.topbar').getBoundingClientRect().bottom,
        compact: document.querySelector('#season-compact').getBoundingClientRect().top,
        tabs: document.querySelector('#season-tabs').getBoundingClientRect().top,
        tbh: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) })"""
    open_tab(page, base, sid, "stats", "#tab-stats .leader-row")        # a long page: it scrolls well past the header
    # a few weeks into the season the Stats page scrolls only ~520 px; give it room, as the checks below do
    page.evaluate("() => { document.body.style.minHeight = '4000px'; }")
    assert not page.evaluate(hidden), "at the top the bar shows"
    page.evaluate("() => window.scrollTo(0, 800)")
    page.wait_for_function(hidden, timeout=10_000)
    page.wait_for_selector("#season-compact:visible", timeout=10_000)
    time.sleep(0.5)                                                        # the 160 ms slide, twice over
    r = page.evaluate(rects)
    assert r["bar"] <= 0, f"the hidden bar is still on screen: {r}"
    assert abs(r["compact"]) <= 1, f"the compact bar sits flush at the top while the bar hides: {r}"
    assert r["tbh"] == 0, f"--topbar-h is 0 while the bar hides: {r}"
    assert abs(r["tabs"] - page.evaluate("() => document.querySelector('#season-compact').getBoundingClientRect().height")) <= 1, f"the tab row sits under the compact bar: {r}"
    # scrolling up 60 px brings it back
    page.evaluate("() => window.scrollTo(0, 740)")
    page.wait_for_function(f"() => !({hidden})()", timeout=10_000)
    time.sleep(0.4)
    r = page.evaluate(rects)
    assert r["bar"] > 40 and r["tbh"] > 40 and abs(r["compact"] - r["tbh"]) <= 1, f"the bar is back and the compact bar sits under it: {r}"
    # scrolling on hides it; the pointer at the top edge brings it back
    page.evaluate("() => window.scrollTo(0, 900)")
    page.wait_for_function(hidden, timeout=10_000)
    page.mouse.move(600, 500)
    page.mouse.move(600, 2)
    page.wait_for_function(f"() => !({hidden})()", timeout=10_000)
    # the keyboard: the focus inside the bar brings it back
    page.mouse.move(600, 500)
    page.evaluate("() => window.scrollTo(0, 1000)")
    page.wait_for_function(hidden, timeout=10_000)
    page.focus("#btn-seasons-menu")
    page.wait_for_function(f"() => !({hidden})()", timeout=10_000)
    # the Seasons menu keeps it on screen while open
    page.click("#btn-seasons-menu")
    page.wait_for_selector(".season-menu .go-menu-item")
    page.evaluate("() => window.scrollTo(0, 1100)")
    time.sleep(0.4)
    assert not page.evaluate(hidden), "the bar stays while its Seasons menu is open"
    page.keyboard.press("Escape")
    # the compact ▾ carries the bar's essentials
    page.evaluate("() => window.scrollTo(0, 1200)")
    page.wait_for_function(hidden, timeout=10_000)
    page.click("#btn-compact-more")
    page.wait_for_selector(".go-menu .go-menu-item:has-text('Settings')")
    names = page.eval_on_selector_all(".go-menu .go-menu-item b", "els => els.map(e => e.textContent)")
    assert "Seasons" in names and "Your Coach" in names and any("theme" in n.lower() for n in names), names
    assert names.index("Your Coach") > names.index("Seasons") > names.index("⚙ Settings"), names
    theme0 = page.evaluate("() => document.documentElement.dataset.theme")
    page.click(".go-menu .go-menu-item:has-text('theme')")
    time.sleep(0.2)
    theme1 = page.evaluate("() => document.documentElement.dataset.theme")
    assert theme1 != theme0 and theme1 in ("light", "dark"), (theme0, theme1)
    page.click("#btn-compact-more")
    page.click(".go-menu .go-menu-item:has-text('theme')")
    time.sleep(0.2)
    assert page.evaluate("() => document.documentElement.dataset.theme") == theme0, "the Theme entry toggles back"
    page.click("#btn-compact-more")
    page.wait_for_selector(".go-menu .go-menu-item:has-text('Seasons')")
    page.click(".go-menu .go-menu-item:has-text('Seasons')")
    page.wait_for_selector(".season-menu .go-menu-item:has-text('New season')", timeout=10_000)
    assert page.get_attribute("#btn-compact-more", "aria-expanded") == "true", "the Seasons menu from the compact bar anchors to its ▾"
    page.keyboard.press("Escape")
    assert not page.query_selector(".go-menu")
    # a phone: the same entries in the compact bar's sheet
    page.set_viewport_size({"width": 400, "height": 860})
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#season:visible")
    page.wait_for_selector("#season-compact:visible", timeout=10_000)
    page.click("#btn-compact-more")
    page.wait_for_selector(".season-head-row:visible", timeout=10_000)
    assert page.is_visible("#btn-sheet-seasons") and page.is_visible(".season-sheet-links a[href='./coach.html']") and page.is_visible("#btn-sheet-theme"), "the sheet carries Seasons, Your coach and Theme"
    page.click("#btn-sheet-theme")
    time.sleep(0.2)
    assert page.evaluate("() => document.documentElement.dataset.theme") != theme0
    page.click("#btn-sheet-theme")
    time.sleep(0.2)
    assert page.evaluate("() => document.documentElement.dataset.theme") == theme0
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.body.classList.contains('head-sheet')")
    # no season open: scrolling never hides it
    page.set_viewport_size({"width": 1280, "height": 1000})
    page.goto(f"{base}/index.html")
    page.wait_for_selector("#btn-new:visible")
    page.evaluate("() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 800); }")
    time.sleep(0.4)
    page.evaluate("() => window.scrollTo(0, 1200)")
    time.sleep(0.4)
    assert not page.evaluate(hidden) and page.evaluate("() => document.querySelector('.topbar').getBoundingClientRect().bottom") > 40, "no season open: the bar stays"
    # the Your coach page: never hidden
    page.goto(f"{base}/coach.html")
    page.wait_for_selector(".topbar")
    page.evaluate("() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 800); }")
    time.sleep(0.4)
    page.evaluate("() => window.scrollTo(0, 1200)")
    time.sleep(0.4)
    assert not page.evaluate(hidden) and page.evaluate("() => document.querySelector('.topbar').getBoundingClientRect().bottom") > 40, "Your coach: the bar stays"
    page.evaluate("() => window.scrollTo(0, 0)")


def test_look_units_pane(page, base, sid) -> None:
    """Looks in trip units on the board's pane: a complete report reads "3 of 3 looks · his report is complete" on the
    Scouting sub-tab, the strip's SCOUTED cell counts looks in halves, and the Recruit menu's Scout item is grayed with the
    409 text; a report short of complete says what is left ("one trip finishes his report")."""
    fmt = lambda n: str(int(n)) if float(n) == int(n) else f"{n:.1f}"
    v = call(base, f"/api/season/{sid}/recruiting")
    rows = [b for b in v["board"] if not b["committed"] and not b["signed"]]
    done = next((b for b in rows if (b.get("looks") or 0) >= 3), None)
    if done is None:                 # complete one through the API: Sends until his report is complete
        done = next(b for b in rows if (b.get("looks") or 0) < 3)
        for _ in range(3):
            if call(base, f"/api/season/{sid}/prospect/{done['id']}")["looks"] >= 3:
                break
            call(base, f"/api/season/{sid}/recruit", {"pid": done["id"], "action": "scout"})
    prof = call(base, f"/api/season/{sid}/prospect/{done['id']}")
    assert prof["looks"] == 3 and prof["can_scout"] is False, (prof["looks"], prof["can_scout"])
    try:
        call(base, f"/api/season/{sid}/recruit", {"pid": done["id"], "action": "scout"})
        raise AssertionError("a Send on a complete report")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        assert e.code == 409 and "his report is complete: 3 of 3 looks" in body, (e.code, body)
    open_tab(page, base, sid, "recruiting", ".go-stages")
    page.click(".go-stages button[data-stage=all]")
    page.click(f".go-row-recruit[data-pid='{done['id']}']")
    page.wait_for_function("(n) => { const h = document.querySelector('.go-pane .go-pane-head'); return h && h.innerText.includes(n) && document.querySelector('.go-pane .go-strip'); }", arg=done["name"], timeout=15_000)
    assert "3 of 3 looks" in page.inner_text(".go-pane .go-strip"), page.inner_text(".go-pane .go-strip")
    page.click(".go-pane .go-subtabs button[data-sub=scouting]")
    page.wait_for_selector(".go-pane .go-scouting", timeout=15_000)
    text = page.inner_text(".go-pane .go-scouting")
    assert "3 of 3 looks · his report is complete" in text, text
    assert "scouting trips" not in text, "no separate trips count"
    page.click("#rc-recruit")
    page.wait_for_selector(".go-menu[role=menu]")
    item = page.query_selector(".go-menu .go-menu-item[data-action=scout]")
    assert item.get_attribute("aria-disabled") == "true", "the Scout item is grayed on a complete report"
    assert "His report is complete: 3 of 3 looks" in item.inner_text(), item.inner_text()
    page.keyboard.press("Escape")
    # one short of complete: the sub-tab says one trip finishes him (an area week is half a look, so 2 or 2.5 both qualify)
    v = call(base, f"/api/season/{sid}/recruiting")
    near = next((b for b in v["board"] if not b["committed"] and not b["signed"] and 0 < 3 - (b.get("looks") or 0) <= 1), None)
    if near is not None:
        page.click(f".go-row-recruit[data-pid='{near['id']}']")
        page.wait_for_function("(n) => { const h = document.querySelector('.go-pane .go-pane-head'); return h && h.innerText.includes(n); }", arg=near["name"], timeout=15_000)
        page.click(".go-pane .go-subtabs button[data-sub=scouting]")
        page.wait_for_function("(t) => { const b = document.querySelector('.go-pane .go-scouting'); return b && b.innerText.includes(t); }", arg=f"{fmt(near['looks'])} of 3 looks · one trip finishes his report", timeout=15_000)
        page.click("#rc-recruit")
        page.wait_for_selector(".go-menu[role=menu]")
        assert "finishes his report" in page.inner_text(".go-menu .go-menu-item[data-action=scout]")
        page.keyboard.press("Escape")


def test_staff_likes_tags(page, base) -> None:
    """"OC likes him": a board row whose complete report says he starts for you shows the tag (title: the coordinator's
    sentence) once on the pane, among its tags (the head keeps to the status chip); the profile says it in a line; the
    Scouting tab's Flags list has him as a "likes" row; a Send that completes a report shows the queue row's "OC ♥" pill at once."""
    from coach_career import offseason
    from coach_career import recruiting
    from sim import season
    me = "ohio-state"
    st = season.new_season(me, "full", seed=13, career=True)
    rc = st["recruiting"]
    oc = next(m["name"] for m in st["career"]["staff"] if m["role"] == "OC")
    tight = lambda p, looks: {"looks": float(looks), "area": 0.0, "by": {"95": float(looks)},
                              "g": {g: [min(99.0, p["truth"][g] + 40.0), 1000.0] for g in recruiting.GROUPS}}
    qbs = [pid for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
           if recruiting._group_of(rc["prospects"][pid]) == "QB" and not rc["prospects"][pid].get("hidden")
           and not rc["status"][pid]["signed"] and not rc["status"][pid]["committed"]
           and sum(1 for o in recruiting._returning(me, "QB") if o >= rc["prospects"][pid]["ovr"]) >= offseason.STARTERS["QB"]]
    liked, nearly = qbs[0], qbs[1]
    rc["reads"][liked] = tight(rc["prospects"][liked], 3)          # a complete report whose read says he starts: liked
    rc["reads"][nearly] = tight(rc["prospects"][nearly], 2)        # one Send from complete: the Send wins him the OC
    rc["board"] = [liked, nearly]
    season.save_season(st)
    sid = st["id"]
    name = rc["prospects"][liked]["name"]
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    try:
        rows = {b["id"]: b for b in call(base, f"/api/season/{sid}/recruiting")["board"]}
        assert rows[liked]["likes"] == {"who": "OC", "name": oc, "text": "Your offensive coordinator thinks he starts for you next year"}, rows[liked]["likes"]
        assert rows[nearly]["likes"] is None
        # the board's pane: the tag among the tags and on the head, the profile's line
        open_tab(page, base, sid, "recruiting", ".go-stages")
        page.click(f".go-row-recruit[data-pid='{liked}']")
        page.wait_for_selector(".go-pane .go-tags .go-tag.go-likes:has-text('OC Likes Him')", timeout=30_000)
        tag = page.query_selector(".go-pane .go-tags .go-tag.go-likes")
        assert "good" in (tag.get_attribute("class") or "") and tag.get_attribute("title") == "Your offensive coordinator thinks he starts for you next year", (tag.get_attribute("class"), tag.get_attribute("title"))
        assert not page.query_selector(".go-pane .go-pane-head .go-likes"), "the head does not repeat the tag"
        assert page.evaluate("() => [...document.querySelectorAll('.go-pane .go-likes')].filter(e => e.getClientRects().length).length") == 1, "the pane says it once"
        assert not page.evaluate("() => [...document.querySelectorAll('.go-row-recruit')].some(r => r.querySelector('.go-tag'))"), "a list row stays one word of standing"
        page.click(".go-pane .go-subtabs button[data-sub=profile]")
        page.wait_for_selector(".go-pane .go-likes-line", timeout=30_000)
        assert page.inner_text(".go-pane .go-likes-line").strip().endswith(f"Your OC, {oc}, thinks he starts for you next year."), page.inner_text(".go-pane .go-likes-line")
        # the one short of complete has no tag yet
        page.click(f".go-row-recruit[data-pid='{nearly}']")
        page.wait_for_function("(n) => { const h = document.querySelector('.go-pane .go-pane-head'); return h && h.innerText.includes(n); }", arg=rc["prospects"][nearly]["name"], timeout=15_000)
        assert not page.query_selector(".go-pane .go-tags .go-tag.go-likes") and not page.query_selector(".go-pane .go-pane-head .go-likes")
        # the Scouting tab: the Flags list has him as a "likes" row with the tag
        open_tab(page, base, sid, "scouting", ".sc-reports .go-subtabs")
        page.click(".sc-reports .go-subtabs button[data-week=flags]")
        page.wait_for_selector(f".sc-reports .sc-flag[data-pid='{liked}'][data-flag=likes]", timeout=15_000)
        row = page.query_selector(f".sc-reports .sc-flag[data-pid='{liked}'][data-flag=likes]")
        assert row.inner_text().strip().lower().startswith("oc likes him"), row.inner_text()
        assert row.query_selector(".go-likes").get_attribute("title") == "Your offensive coordinator thinks he starts for you next year"
        assert name in row.inner_text()
        assert not page.query_selector(f".sc-reports .sc-flag[data-pid='{nearly}']")
        v = call(base, f"/api/season/{sid}/scouting")
        assert all(r["likes"] is None for r in v["queue"] if r["looks"] < 3), "an open report has no like yet"
        assert next(r for r in v["queue"] if r["pid"] == liked)["likes"]["who"] == "OC", "the board's complete report stays in the queue with his like"
        assert v["hours_left"] >= 5, v["hours_left"]
        # the queue: the Send that completes his report shows the pill in the NAME cell and the tag in the result row
        page.wait_for_selector(f".sc-table .sc-row[data-pid='{nearly}'] .sc-send", timeout=15_000)
        assert not page.query_selector(f".sc-row[data-pid='{nearly}'] .sc-likes")
        page.click(f".sc-row[data-pid='{nearly}'] .sc-send")
        page.wait_for_selector(f".sc-row[data-pid='{nearly}'] .sc-likes", timeout=15_000)
        pill = page.query_selector(f".sc-row[data-pid='{nearly}'] .sc-c-name .sc-likes")
        assert pill.inner_text().strip().lower() == "oc ♥" and pill.get_attribute("title") == "Your offensive coordinator thinks he starts for you next year", (pill.inner_text(), pill.get_attribute("title"))
        assert not page.query_selector(f".sc-row[data-pid='{nearly}'] .sc-c-name .sc-likes[hidden]")
        page.wait_for_function("(pid) => { const r = document.querySelector(`.sc-row[data-pid='${pid}']`); return r && r.nextElementSibling && r.nextElementSibling.classList.contains('sc-result-row') && r.nextElementSibling.querySelector('.go-likes'); }", arg=nearly, timeout=15_000)
        assert page.inner_text(f".sc-row[data-pid='{nearly}'] + .sc-result-row .go-likes").strip().lower() == "oc likes him"
        assert next(b for b in call(base, f"/api/season/{sid}/recruiting")["board"] if b["id"] == nearly)["likes"]["who"] == "OC"
        assert not errs, errs
    finally:
        call(base, f"/api/season/{sid}", method="DELETE")


def check_staff_contracts(page, base, sid) -> None:
    """The Staff step's contracts: every staying member shows his through year ("Signed through 2028",
    or "Re-signed through 2030" when his contract was up and he stayed) and a candidate card says
    how long he wants ("Wants 3 years (through 2029)")."""
    v = call(base, f"/api/season/{sid}/offseason")
    assert v["stage"] == "staff", v["stage"]
    st = v["staff"]
    leaving = {w["id"] for w in st["leaving"]}
    text = page.inner_text("#tab-offseason .off-staff")
    for m in v["your_staff"]:
        if m["id"] in leaving:
            continue
        renewed = next((r for r in st["renewed"] if r["id"] == m["id"]), None)
        want = f"Re-signed Through {renewed['through']}" if renewed else f"Signed Through {m['contract_until']}"
        assert want.upper() in text.upper(), (want, text[:400])
    cards = page.query_selector_all("#tab-offseason .off-cand")
    if cards:
        asks = [c.inner_text() for c in cards if re.search(r"Wants \d years? \(through \d{4}\)", c.inner_text())]
        assert asks, [c.inner_text()[:120] for c in cards[:2]]
    for w in st["leaving"]:
        if st["contract"][w["id"]]["expiring"]:
            assert "CONTRACT UP" in text.upper(), text[:400]
            break


def check_staff_developed(page, base, sid) -> None:
    """The Staff step's "Your staff developed": a row per staff member (and you) with each rating that
    moved as "Evaluation 61 → 64 (+3)" and a why tag, like Development's Who improved."""
    v = call(base, f"/api/season/{sid}/offseason")
    rows = v["staff"]["developed"]
    assert {r["id"] for r in rows} >= {m["id"] for m in v["your_staff"]}, [r["id"] for r in rows]
    text = page.inner_text("#tab-offseason .off-dev")
    assert "YOUR STAFF DEVELOPED" in page.inner_text("#tab-offseason .off-staff")
    for r in rows:
        li = page.query_selector(f"#tab-offseason .off-dev li[data-key=dev-{r['id']}]")
        assert li, r["id"]
        for c in r["changes"]:
            n = c["to"] - c["from"]
            assert f"{c['rating']} {c['from']} → {c['to']} ({'+' if n > 0 else ''}{n})" in li.inner_text(), (c, li.inner_text())
        if not r["changes"]:
            assert "No Change" in li.inner_text()
    assert not re.search(r"\bundefined\b|\bnull\b|NaN", text), text[:200]

# ----- the grade cards' tooltips and a complete report's final grades (final-grade brief) -----

TIP_STATE = """(cell) => { const t = cell.querySelector('.go-tip-box'); if (!t) return { tip: false };
  const shown = t.classList.contains('show'), r = t.getBoundingClientRect();
  const box = cell.closest('.go-pane') || cell.closest('.modal-body'); const pr = box.getBoundingClientRect();
  const pts = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [(r.left + r.right) / 2, (r.top + r.bottom) / 2], [r.left + 4, r.bottom - 4]];
  t.style.pointerEvents = 'auto';     // the tip takes no pointer events (so it never blocks a card); hit-test it anyway to see what paints over it
  const over = pts.map(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (t.contains(e) ? 'tip' : (e.className || e.tagName).toString().slice(0, 40)) : 'offscreen'; });
  t.style.pointerEvents = '';
  const parents = []; for (let n = t.parentElement; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.transform !== 'none' || s.filter !== 'none' || s.willChange !== 'auto') parents.push(n.className); }
  return { tip: true, shown, visible: shown && t.getClientRects().length > 0 && getComputedStyle(t).display !== 'none', rect: [r.left, r.top, r.right, r.bottom],
           inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, box: [pr.left, pr.top, pr.right, pr.bottom],
           onTop: over.every(o => o === 'tip'), over, transformed: parents }; }"""


def hover_grades(page, scope: str, where: str, height: int, escape: bool = False) -> None:
    """Every grade card under `scope`: hover shows its tooltip, visible, inside the viewport and on top of everything (not
    clipped by the pane or the modal, no transformed ancestor); the pointer off, it closes; focus shows it too, and the
    focus leaving closes it. escape: Escape closes it too (checked only where Escape does not also close the window around it:
    the desktop pane; the phone's sheet and the Prospects modal close on Escape)."""
    cells = page.query_selector_all(f"{scope} .go-grades .go-stat")
    assert cells, f"grade cards in {where}"
    for c in cells:
        c.scroll_into_view_if_needed()
        time.sleep(0.15)
        assert "go-tip" in (c.get_attribute("class") or ""), f"a grade card without a tooltip in {where}: {c.inner_text()!r}"
        c.hover()
        time.sleep(0.25)
        st = page.evaluate(TIP_STATE, c)
        assert st["shown"] and st["visible"], f"hovering a grade shows its tooltip in {where}: {st}"
        assert st["inViewport"], f"the tooltip sits inside the viewport in {where}: {st}"
        assert st["onTop"], f"the tooltip is on top, not clipped or covered, in {where}: {st}"
        assert not st["transformed"], f"a transformed ancestor would pin the fixed tooltip to it in {where}: {st}"
        page.mouse.move(2, height - 2)
        time.sleep(0.2)
        assert not page.evaluate(TIP_STATE, c)["shown"], f"the pointer off the grade closes its tooltip in {where}"
        c.focus()
        time.sleep(0.2)
        st = page.evaluate(TIP_STATE, c)
        assert st["shown"] and st["visible"] and st["inViewport"] and st["onTop"], f"focusing a grade shows its tooltip in {where}: {st}"
        if escape:
            page.keyboard.press("Escape")
            time.sleep(0.15)
            assert not page.evaluate(TIP_STATE, c)["shown"], f"Escape closes the tooltip in {where}"
        page.evaluate("() => document.activeElement && document.activeElement.blur()")     # the focus off the card (the next one's focus() is a fresh focus event)
        time.sleep(0.1)
        assert not page.evaluate(TIP_STATE, c)["shown"], f"the focus leaving the grade closes its tooltip in {where}"


def test_grade_hover(page, base, sid) -> None:
    """A complete report's grade cards: on the board pane's Profile and Scouting sub-tabs and on the Prospects tab's full
    profile, at 1280 and 400 (a tap there), hovering or focusing any card shows its "looks like" tooltip, visible, inside the
    viewport and on top; the cards read one word each ("Strong", never "Solid to Strong") under the final-grades line; an
    open report keeps its ranges."""
    board = call(base, f"/api/season/{sid}/recruiting")["board"]
    done = next((b for b in board if (b.get("looks") or 0) >= 3 and b.get("our_grades")), None)
    if done is None:
        rows = call(base, f"/api/season/{sid}/prospects?limit=5000")["rows"]
        pick = next(r for r in rows if (r.get("looks") or 0) >= 3)
        call(base, f"/api/season/{sid}/board", {"pid": pick["id"], "on": True})
        done = next(b for b in call(base, f"/api/season/{sid}/recruiting")["board"] if b["id"] == pick["id"])
    prof = call(base, f"/api/season/{sid}/prospect/{done['id']}")
    assert prof["looks"] >= 3 and all(lo == hi for lo, hi in prof["our_grades"].values()), prof["our_grades"]
    assert all(lo == hi for lo, hi in done["our_grades"].values()), done["our_grades"]
    opened = next((b for b in board if 0 < (b.get("looks") or 0) < 3 and b.get("our_grades")), None)   # an open report: its line says the ranges still narrow
    for width, height in ((1280, 800), (400, 760)):
        page.set_viewport_size({"width": width, "height": height})
        # the board pane: the Profile sub-tab, then the Scouting sub-tab (its tooltips arrive with his profile)
        open_tab(page, base, sid, "recruiting", ".go-stages")
        page.click(".go-stages button[data-stage=all]")
        page.click(f".go-row-recruit[data-pid='{done['id']}']")
        page.wait_for_function("(n) => { const h = document.querySelector('.go-pane .go-pane-head'); return h && h.innerText.includes(n); }", arg=done["name"], timeout=15_000)
        page.click(".go-pane .go-subtabs button[data-sub=profile]")
        page.wait_for_selector(".go-pane .go-sub-body.go-profile .go-grades .go-stat.go-tip", timeout=60_000)
        time.sleep(0.4)
        words = page.eval_on_selector_all(".go-pane .go-profile .go-grades .go-stat-val", "els => els.map(e => e.textContent.trim())")
        assert words and all(" to " not in w and w in ("All-American", "Elite", "Strong", "Solid", "Fair", "Weak") for w in words), f"one final grade per card at {width}: {words}"
        note = page.inner_text(".go-pane .go-profile .go-grades-note")
        assert "3 of 3 looks: his report is complete: these are your staff's final grades." in note and "A read can still be wrong; the truth shows once he is on your roster." in note, note
        assert "Ranges narrow" not in note, note
        hover_grades(page, ".go-pane .go-profile", f"the pane's Profile sub-tab at {width}", height, escape=width > 700)
        page.click(".go-pane .go-subtabs button[data-sub=scouting]")
        page.wait_for_selector(".go-pane .go-scouting .go-grades .go-stat.go-tip", timeout=30_000)
        time.sleep(0.3)
        note = page.inner_text(".go-pane .go-scouting .go-grades-note")
        assert "3 of 3 looks · his report is complete: these are your staff's final grades." in note, note
        words = page.eval_on_selector_all(".go-pane .go-scouting .go-grades .go-stat-val", "els => els.map(e => e.textContent.trim())")
        assert all(" to " not in w for w in words), words
        hover_grades(page, ".go-pane .go-scouting", f"the pane's Scouting sub-tab at {width}", height)
        if opened:          # an open report's Scouting sub-tab keeps its ranges and its narrowing line
            if width <= 700:
                page.click(".go-pane .go-pane-back")
                time.sleep(0.4)
            page.click(f".go-row-recruit[data-pid='{opened['id']}']")
            page.wait_for_function("(n) => { const h = document.querySelector('.go-pane .go-pane-head'); return h && h.innerText.includes(n); }", arg=opened["name"], timeout=15_000)
            page.click(".go-pane .go-subtabs button[data-sub=scouting]")
            page.wait_for_selector(".go-pane .go-scouting .go-grades-note", timeout=30_000)
            note = page.inner_text(".go-pane .go-scouting .go-grades-note")
            assert "final grades" not in note and "ranges narrow with every look" in note, note
        if width <= 700:
            page.click(".go-pane .go-pane-back")
            time.sleep(0.4)
        # the Prospects tab's full profile (a modal)
        open_tab(page, base, sid, "prospects", ".go-list-row")
        page.fill("#tab-prospects input[type=search]", done["name"])
        page.wait_for_selector(f"#tab-prospects .go-list-row:has-text('{done['name']}')", timeout=30_000)
        time.sleep(0.5)
        page.click(f"#tab-prospects .go-list-row:has-text('{done['name']}') .go-list-id")
        page.wait_for_selector(".modal .go-profile .go-grades .go-stat.go-tip", timeout=60_000)
        time.sleep(0.4)
        assert done["name"].upper() in page.inner_text(".modal .go-profile"), "the profile is his"
        words = page.eval_on_selector_all(".modal .go-profile .go-grades .go-stat-val", "els => els.map(e => e.textContent.trim())")
        assert words and all(" to " not in w for w in words), f"one final grade per card on the full profile at {width}: {words}"
        assert "these are your staff's final grades" in page.inner_text(".modal .go-profile .go-grades-note")
        hover_grades(page, ".modal .go-profile", f"the Prospects profile at {width}", height)
        # a tap (the phone) opens it too
        if width <= 700:
            page.mouse.move(2, height - 2)
            first = page.query_selector(".modal .go-profile .go-grades .go-stat")
            first.scroll_into_view_if_needed()
            first.click()
            time.sleep(0.3)
            st = page.evaluate(TIP_STATE, first)
            assert st["shown"] and st["visible"] and st["inViewport"], f"a tap shows the tooltip at {width}: {st}"
        page.evaluate("() => { const c = document.querySelector('.modal:not([hidden]) .modal-close'); if (c) c.click(); }")
        time.sleep(0.3)
    page.set_viewport_size({"width": 1280, "height": 1000})


# ----- a committed recruit's profile: his chance to flip in words, never a number (final-grade brief) -----

FLIP_WORDS = {"None", "Slim", "Real", "Likely"}


def test_flip_words(page, base) -> None:
    """The profile of a recruit committed to you: the banner's second line says where he stands in words (no "%"), the
    table under "Who else is calling" carries one of the four flip words per rival (or one line when nobody is close);
    committed elsewhere: "His chance to flip to each", the words again, your row marked. The API carries `flip`."""
    from coach_career import recruiting
    from sim import season
    me = "ohio-state"
    st = season.new_season(me, "full", seed=21, career=True)
    rc = st["recruiting"]
    ranked = sorted((pid for pid in rc["prospects"] if not rc["prospects"][pid].get("hidden") and not rc["status"][pid]["signed"] and not rc["status"][pid]["committed"]),
                    key=lambda q: rc["prospects"][q]["rank"])
    mine, theirs = ranked[0], ranked[1]
    rivals = [s for s in ("georgia", "alabama", "michigan") if s in recruiting.fbs_schools(st)]
    for s in rivals:                                        # three rivals with offers out to both
        for pid in (mine, theirs):
            if pid not in rc["offers"].setdefault(s, []):
                rc["offers"][s].append(pid)
    rc["offers"].setdefault(me, [])
    for pid in (mine, theirs):
        if pid not in rc["offers"][me]:
            rc["offers"][me].append(pid)
    rc["status"][mine].update(committed=me, hard=False)
    rc["status"][theirs].update(committed=rivals[0], hard=False)
    season.save_season(st)
    sid = st["id"]
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    try:
        prof = call(base, f"/api/season/{sid}/prospect/{mine}")
        flip = prof["flip"]
        assert flip and set(flip) == {"total", "word", "rivals"} and flip["word"] in FLIP_WORDS, flip
        assert [r["school"] for r in flip["rivals"]] == sorted((r["school"] for r in flip["rivals"]), key=lambda s: -next(x["pct"] for x in flip["rivals"] if x["school"] == s))
        assert all(set(r) == {"school", "name", "pct", "word"} and r["word"] in FLIP_WORDS and r["school"] != me for r in flip["rivals"]), flip
        assert abs(sum(r["pct"] for r in flip["rivals"]) - flip["total"]) < 1e-3
        assert call(base, f"/api/season/{sid}/prospect/{ranked[2]}")["flip"] is None, "no commitment, nothing to flip from"
        for pid, holder in ((mine, me), (theirs, rivals[0])):
            prof = call(base, f"/api/season/{sid}/prospect/{pid}")
            open_tab(page, base, sid, "prospects", ".go-list-row")
            page.fill("#tab-prospects input[type=search]", prof["public"]["name"])
            page.wait_for_selector(f"#tab-prospects .go-list-row:has-text(\"{prof['public']['name']}\")", timeout=30_000)
            time.sleep(0.5)
            page.click(f"#tab-prospects .go-list-row:has-text(\"{prof['public']['name']}\") .go-list-id")
            page.wait_for_selector(".modal .go-profile .go-commit", timeout=60_000)
            banner = page.inner_text(".modal .go-profile .go-commit")
            assert "%" not in banner and "Still considering" not in banner, banner
            lines = [t for t in banner.split("\n") if t.strip()]
            assert lines[0].startswith("VERBAL COMMIT TO"), lines
            word = prof["flip"]["word"]
            leader = prof["flip"]["rivals"][0]["name"] if prof["flip"]["rivals"] else None
            expect = ("Solid: nobody is close to pulling him away" if word == "None" or not leader
                      else f"Hearing out {leader}: a slim chance he flips before signing day" if word == "Slim"
                      else f"{leader} is working him hard: a real chance he flips" if word == "Real" else f"{leader} is close to flipping him")
            assert lines[1] == expect, (lines, word)
            heads = [h.strip().lower() for h in page.eval_on_selector_all(".modal .go-profile h3", "els => els.map(e => e.textContent)")]
            if holder == me:
                assert "who else is calling" in heads, heads
                if page.query_selector(".modal .go-profile .go-nobody-close"):
                    assert word == "None" and page.inner_text(".modal .go-profile .go-nobody-close") == "Nobody is close to pulling him away."
                    assert not page.query_selector(".modal .go-profile .go-schools"), "no table when nobody is close"
                else:
                    assert word != "None"
            else:
                assert "his chance to flip to each" in heads, heads
                assert page.query_selector(".modal .go-profile .go-school.yours"), "your own row is marked among his rivals"
                assert "(you)" in page.inner_text(".modal .go-profile .go-school.yours")
            rows = page.eval_on_selector_all(".modal .go-profile .go-schools .go-school", "els => els.map(e => [e.querySelector('b').textContent, e.querySelector('.go-school-odds').textContent.trim(), e.lastElementChild.textContent])")
            for name, w, marks in rows:
                assert w in FLIP_WORDS or w == "no offer", (name, w)
                if w in FLIP_WORDS:
                    assert "Offer" in marks, (name, marks)
            assert "%" not in page.inner_text(".modal .go-profile .go-schools") if rows else True
            words_by_api = {r["name"]: r["word"] for r in prof["flip"]["rivals"]}
            assert all(words_by_api.get(name, "no offer") == w for name, w, _ in rows), (rows, words_by_api)
            assert [name for name, w, _ in rows if w in FLIP_WORDS] == [r["name"] for r in prof["flip"]["rivals"] if r["name"] in {n for n, _, _ in rows}], "rivals sorted by their chance"
            page.evaluate("() => { const c = document.querySelector('.modal:not([hidden]) .modal-close'); if (c) c.click(); }")
            time.sleep(0.3)
        assert not errs, errs
    finally:
        call(base, f"/api/season/{sid}", method="DELETE")


def present_three(page, pane: str = ".go-pane") -> None:
    """A call or visit just opened: the conversation shows your opener and his answer; pick three things and Present,
    which brings his cue in place (the cue and his question follow your opening)."""
    page.wait_for_selector(f"{pane} .go-scene .go-opening .go-present-chip", timeout=30_000)
    if page.query_selector(f"{pane} .go-scene .go-scene-line.cue"):
        return
    assert page.eval_on_selector(f"{pane} .go-scene .go-opening .go-present", "e => e.disabled"), "Present waits for three"
    # clicks from the page itself: Playwright's would scroll an off-screen chip into view, which a smoothness watch counts
    page.eval_on_selector_all(f"{pane} .go-scene .go-opening .go-present-chip", "els => els.slice(0, 3).forEach((e) => e.click())")
    assert page.inner_text(f"{pane} .go-scene .go-present-count").strip() == "3 of 3"
    assert not page.eval_on_selector(f"{pane} .go-scene .go-opening .go-present", "e => e.disabled")
    page.eval_on_selector(f"{pane} .go-scene .go-opening .go-present", "e => e.click()")
    page.wait_for_selector(f"{pane} .go-scene .go-scene-line.cue", timeout=30_000)
    page.wait_for_selector(f"{pane} .go-scene .go-opening", state="detached", timeout=10_000)


def test_conversation(page, base) -> None:
    """A call reads as a conversation (its own career, week two so his small talk has a game to talk about): "You:"
    bubbles right, his left, your opener names him and you, his first answer names your last opponent, your opening
    (a fourth chip is refused, Present brings his reaction, your question and the cue in place, the opening block
    leaves), "WHAT YOU LEAD WITH", and his reaction to the pitch joins the conversation as a turn, then the board catches
    up and the scene leaves. A visit opens with the room."""
    from coach_career import recruiting, scenes
    from sim import season
    me = "smu"
    st = season.new_season(me, "full", seed=23, career=True)
    season.advance_to(st, 2)
    rc = st["recruiting"]
    rc["hours"][me] = 200
    game = scenes.last_game(st, me, st["current_week"])
    assert game, "a game to talk about"
    pids = [q for q in recruiting.prospect_list(st) if not rc["prospects"][q].get("hidden") and me not in rc["contacts"].get(q, {})
            and not rc["status"][q]["committed"] and not recruiting.would_pester(st, me, q)][:2]
    rc["board"] = list(pids)
    season.save_season(st)
    sid = st["id"]
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    try:
        pid, other = pids
        first = rc["prospects"][pid]["name"].split()[0]
        coach = scenes.coach_name(st, me)
        open_tab(page, base, sid, "recruiting", ".go-stages")
        page.click(f".go-row-recruit[data-pid='{pid}']")
        time.sleep(0.4)
        page.click("#rc-recruit")
        page.click(".go-menu .go-menu-item[data-action=call]")
        page.wait_for_selector(".go-pane .go-scene .go-opening", timeout=30_000)
        turns = page.eval_on_selector_all(".go-pane .go-scene .go-convo .go-turn", "els => els.map(e => [e.className, e.textContent])")
        assert len(turns) == 2 and "you" in turns[0][0].split() and "him" in turns[1][0].split(), turns
        assert turns[0][1].startswith("You:") and first in turns[0][1] and coach in turns[0][1], turns[0]
        assert game["opponent"] in turns[1][1], (turns[1], game)
        you_right = page.evaluate("() => { const y = document.querySelector('.go-pane .go-turn.you').getBoundingClientRect(), h = document.querySelector('.go-pane .go-turn.him').getBoundingClientRect(); return y.right > h.right + 20 && y.left > h.left; }")
        assert you_right, "your bubble sits right, his left"
        assert not page.query_selector(".go-pane .go-scene .go-scene-line.cue"), "the cue waits on your opening"
        assert "YOUR OPENING" in page.inner_text(".go-pane .go-scene") and "WHAT YOU LEAD WITH" not in page.inner_text(".go-pane .go-scene")
        chips = page.query_selector_all(".go-pane .go-scene .go-present-chip")
        assert len(chips) == 7 and all(c.get_attribute("aria-pressed") == "false" for c in chips)
        for c in chips[:3]:
            c.click()
        chips[3].click()
        toasted(page, "Three things. Drop one first.")
        assert chips[3].get_attribute("aria-pressed") == "false" and page.inner_text(".go-pane .go-present-count").strip() == "3 of 3"
        h = watch(page, ".go-pane .go-scene", ".go-pane .go-present", scrolled=False)
        page.click(".go-pane .go-present")
        page.wait_for_selector(".go-pane .go-scene .go-scene-line.cue", timeout=30_000)
        page.wait_for_selector(".go-pane .go-scene .go-opening", state="detached", timeout=10_000)
        smooth(page, h, "Present")
        b = next(x for x in call(base, f"/api/season/{sid}/recruiting")["board"] if x["id"] == pid)
        sc = b["scene"]
        assert sc["presented"] and len(sc["presented"]) == 3 and sc["cue"]
        turns = page.eval_on_selector_all(".go-pane .go-scene .go-convo .go-turn", "els => els.map(e => [e.className, e.textContent])")
        assert [t["who"] for t in sc["turns"]] == [next(w for w in ("you", "him", "note") if w in c.split()) for c, _ in turns], (turns, sc["turns"])
        assert turns[2][1].startswith("You:") and "cue" in turns[5][0].split() and turns[5][1] == sc["cue"]["text"], turns
        assert "WHAT YOU LEAD WITH" in page.inner_text(".go-pane .go-scene") and "YOUR PITCH" not in page.inner_text("body")
        hist = page.inner_text("body")
        # the pitch: his reaction joins the conversation, then the board catches up and the scene leaves
        topic = sc["cue"]["topics"][0]
        page.click(f".go-pane .go-pitch:has(input[value='{topic}'])")
        n = draws(page)
        page.click(".go-pane .go-scene button:has-text('Pitch')")
        page.wait_for_selector(".go-pane .go-scene .go-convo .go-turn.go-reaction", timeout=30_000)
        kind = page.get_attribute(".go-pane .go-reaction", "data-kind")
        assert kind in ("hit", "polite", "quiet"), kind
        turns = page.eval_on_selector_all(".go-pane .go-scene .go-convo .go-turn", "els => els.map(e => [e.className, e.textContent])")
        assert turns[-2][1].startswith("You:") and "go-reaction" in turns[-1][0], turns[-2:]
        assert "counts at the week step" in page.inner_text(".go-pane .go-scene .go-scene-acts")
        assert page.evaluate("() => [...document.querySelectorAll('.go-pane .go-scene .go-pitches input')].every(r => r.disabled)"), "what you led with stays on record, locked"
        assert not page.query_selector(".go-pane .go-scene button:has-text('Pitch')"), "the buttons gave way"
        settle(page, n)
        assert page.query_selector(".go-pane .go-scene .go-reaction"), "the finished conversation stays until the pane moves on"
        assert "Hang Up" not in page.inner_text(".go-pane .go-scene"), "a finished conversation has nothing left to do"
        # History: the opening's line
        page.click(".go-subtabs button[data-sub=history]")
        time.sleep(0.3)
        hist = page.inner_text(".go-pane")
        assert re.search(r"Presented [a-zA-Z ]+, [a-zA-Z ]+, [a-zA-Z ]+ · (none|one|two|three) landed", hist), hist
        # a visit opens with the room, then you in the living room
        page.click(f".go-row-recruit[data-pid='{other}']")
        time.sleep(0.5)
        assert not page.query_selector(".go-pane .go-scene"), "another recruit's pane starts without the old conversation"
        page.click("#rc-recruit")
        page.click(".go-menu .go-menu-item[data-action=hc_visit]")
        page.wait_for_selector(".go-pane .go-scene .go-opening", timeout=30_000)
        turns = page.eval_on_selector_all(".go-pane .go-scene .go-convo .go-turn", "els => els.map(e => [e.className, e.textContent])")
        assert len(turns) == 3 and "note" in turns[0][0].split() and "you" in turns[1][0].split() and "him" in turns[2][0].split(), turns
        present_three(page)
        turns = page.eval_on_selector_all(".go-pane .go-scene .go-convo .go-turn", "els => els.map(e => [e.className, e.textContent])")
        assert any("His dad" in t for _, t in turns), turns
        assert "null" not in page.inner_text(".go-pane .go-scene") and "{" not in page.inner_text(".go-pane .go-scene")
        assert not errs, errs
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass


def test_sim_bar(page, base) -> None:
    """A three-week sim from the Office on a fresh career: the overlay's bar, sampled every 100 ms, never
    shrinks, shows under 100% while the sim runs and fills at the end; the stage line says what is happening."""
    sid = call(base, "/api/season", {"team": "smu", "seed": 5})["id"]
    try:
        page.goto(f"{base}/index.html?id={sid}")
        page.wait_for_selector("#season:visible")
        page.click("#season-tabs button[data-tab=office]")
        page.wait_for_selector(".go-play [data-play=advance]", timeout=60_000)
        page.click("#tab-office .go-play .go-play-more")
        page.wait_for_selector(".go-menu .go-menu-item")
        page.evaluate("""() => { window.__bar = []; window.__barTimer = setInterval(() => { const ov = document.getElementById('sim-overlay'); if (ov.hidden) return;
            const bar = document.getElementById('sim-bar'); window.__bar.push([bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width,
            document.getElementById('sim-sub').textContent, document.getElementById('sim-stage').textContent]); }, 100); }""")
        page.click(".go-menu .go-menu-item:has(b:text-is('Week 3'))")
        page.wait_for_selector("#sim-overlay:visible", timeout=30_000)
        page.wait_for_selector("#sim-overlay", state="hidden", timeout=300_000)
        samples = page.evaluate("() => { clearInterval(window.__barTimer); return window.__bar; }")
        assert len(samples) > 20, f"only {len(samples)} samples of the bar"
        widths = [w for w, _, _ in samples]
        back = [(a, b) for a, b in zip(widths, widths[1:]) if b < a - 0.002]
        assert not back, f"the bar went back: {back[:3]}"
        assert all(t != "100%" for _, t, _ in samples[:-1]), "100% before the sim was done"
        assert widths[-1] > 0.8, f"the bar ended at {widths[-1]:.2f}"
        assert page.evaluate("() => document.getElementById('sim-bar').style.width") == "100%", "the bar fills when the sim is done"
        stages = {st for _, _, st in samples}
        assert any(st.startswith("Playing Week 2 games · ") for st in stages), stages
        assert not any("Simming" in st or "null" in st or "undefined" in st for st in stages), stages
    finally:
        call(base, f"/api/season/{sid}", method="DELETE")


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
    # one prospect past the signed classes holds a verbal commit elsewhere, so the board can show a lost card's flip odds
    rc = done["recruiting"]
    verbal_pid = next(q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
                      if not rc["status"][q]["signed"] and q not in rc["offers"].get("ohio-state", []))
    rc["status"][verbal_pid].update(committed="georgia", hard=False)
    # and one hard-committed elsewhere with your offer out: the board lets you pull that offer back
    hard_pid = next(q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
                    if not rc["status"][q]["signed"] and q != verbal_pid and q not in rc["offers"].get("ohio-state", []))
    rc["status"][hard_pid].update(committed="georgia", hard=True)
    rc["offers"].setdefault("ohio-state", []).append(hard_pid)
    # and one hard-committed elsewhere without your offer: no offer can go out to him
    hard_noffer_pid = next(q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
                           if not rc["status"][q]["signed"] and q not in (verbal_pid, hard_pid) and q not in rc["offers"].get("ohio-state", [])
                           and not rc["prospects"][q].get("hidden"))     # a hidden prospect cannot go on the board
    rc["status"][hard_noffer_pid].update(committed="georgia", hard=True)
    season.save_season(done)
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    # CFP_QUESTION_RATE=0: no recruit opens a call with a question (the sweep pitches on its calls; a question locks the pitch until it is answered)
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port), "CFP_QUESTION_RATE": "0"},
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
            page.click("button.go-chip:has-text('Recommended for You')")
            page.wait_for_selector("button.go-btn:has-text('Add These')", timeout=120_000)
            page.click("button.go-btn:has-text('Add These')")
            time.sleep(4)
            page.click(".go-list-row .go-list-id >> nth=0")
            page.wait_for_selector(".go-profile .go-display", timeout=60_000)
            for _ in range(3):
                sc = page.query_selector(".go-profile button:has-text('Send a Scout')")
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

            # --- Recruiting board: stage tabs with counts, a plain list, one pane; nothing scrolls sideways
            page.set_viewport_size({"width": 1280, "height": 1000})
            page.evaluate("() => { try { localStorage.setItem('cfp.theme', 'dark'); } catch (e) {} }")    # the dark theme for the screenshots (the headless default is light)
            open_tab(page, base, A, "recruiting", ".go-stages")
            v = call(base, f"/api/season/{A}/recruiting")
            board_n = len(v["board"])
            counts = page.evaluate("() => [...document.querySelectorAll('.go-stages button[data-stage]')].map(b => [b.dataset.stage, +b.querySelector('b').textContent])")
            assert [c[0] for c in counts] == ["all", "cold", "contact", "top", "visited", "committed"], counts
            assert counts[0][1] == board_n and sum(c[1] for c in counts[1:]) == board_n, (counts, board_n)
            assert not page.query_selector(".go-col, .go-pcard, .go-pipeline, .go-ticker"), "the columns, the cards and the ticker are gone"
            assert page.evaluate("() => document.querySelectorAll('.go-list .go-row-recruit[data-pid]').length") == board_n
            # a row is a button holding the word of standing and nothing else: no tags, bars or buttons
            assert page.evaluate("""() => [...document.querySelectorAll('.go-row-recruit')].every(r => r.tagName === 'BUTTON' && r.hasAttribute('aria-pressed')
                && r.querySelector('.go-standing-word') && !r.querySelector('.go-tag, .go-bar, button, .go-badge'))"""), "a row is a button with one word of standing"
            words = page.eval_on_selector_all(".go-row-recruit .go-standing-word", "els => els.map(e => e.textContent.trim())")
            assert words and set(words) <= {"Favorite", "In It", "Long Shot", "Yours", "Lost", "Not Offered"}, words
            shot(page, "board-1280-dark")
            # a tab filters the list and shows as pressed
            stage, n = next(((c[0], c[1]) for c in counts[1:] if 0 < c[1] < board_n), (None, None))
            if stage:
                page.click(f".go-stages button[data-stage='{stage}']")
                time.sleep(0.4)
                assert page.evaluate("() => document.querySelectorAll('.go-row-recruit').length") == n, "the tab filters the list"
                assert page.get_attribute(f".go-stages button[data-stage='{stage}']", "aria-pressed") == "true"
                page.click(".go-stages button[data-stage='all']")
                time.sleep(0.4)
            # a stage tab and the sort keep the focus through the redraw they cause, as the search does
            page.click(".go-stages button[data-stage='contact']")
            time.sleep(0.3)
            assert page.evaluate("() => document.activeElement.dataset.stage") == "contact", "a stage tab keeps the focus after the redraw"
            page.click(".go-stages button[data-stage='all']")
            time.sleep(0.3)
            assert page.evaluate("() => document.activeElement.dataset.stage") == "all"
            page.focus(".go-tools select.go-sel")
            page.select_option(".go-tools select.go-sel", "rank")
            time.sleep(0.3)
            assert page.evaluate("() => document.activeElement.matches('.go-tools select.go-sel') && document.activeElement.value === 'rank'"), "the sort keeps the focus after the redraw"
            page.select_option(".go-tools select.go-sel", "chance")
            time.sleep(0.3)
            # sorting by your chance follows the ladder: a recruit you lead without an offer sits above one you trail with one (close
            # or far behind); yours first, lost last; ties by the bar, then national rank
            ladder = page.evaluate("""() => {
              const L = (id, o) => ({ id, name: id, position: "QB", national_rank: 50, offered: false, committed: null, signed: null, list: [], standing: {}, ...o });
              const me = { school: "smu", you: true }, ga = { school: "georgia" };
              const rows = [
                L("lost", { signed: "georgia", national_rank: 1 }),
                L("trail", { offered: true, list: [{ ...ga, bar: 1, rank: 1 }, { ...me, bar: 0.05, rank: 2 }], standing: { pct: 0.04 }, national_rank: 2 }),
                L("lead", { list: [{ ...me, bar: 1, rank: 1 }, { ...ga, bar: 0.7, rank: 2 }], standing: { pct: null }, national_rank: 3 }),
                L("cold", { national_rank: 4 }),
                L("init", { offered: true, list: [{ ...ga, bar: 1, rank: 1 }, { ...me, bar: 0.95, rank: 2 }], standing: { pct: 0.35 }, national_rank: 5 }),
                L("fav2", { offered: true, list: [{ ...me, bar: 1, rank: 1 }, { ...ga, bar: 0.5, rank: 2 }], standing: { pct: 0.5 }, national_rank: 6 }),
                L("fav1", { offered: true, list: [{ ...me, bar: 1, rank: 1 }, { ...ga, bar: 0.5, rank: 2 }], standing: { pct: 0.7 }, national_rank: 9 }),
                L("favtie", { offered: true, list: [{ ...me, bar: 1, rank: 1 }, { ...ga, bar: 0.5, rank: 2 }], standing: { pct: 0.7 }, national_rank: 7 }),
                L("yours", { committed: "smu", national_rank: 8 }),
              ];
              const R = window.CFP.recruiting;
              return [rows.slice().sort(R.byChance("smu")).map((b) => b.id), Object.fromEntries(rows.map((b) => [b.id, R.standingOf(b, "smu").word]))];
            }""")
            assert ladder[1] == {"lost": "Lost", "trail": "Long Shot", "lead": "Not Offered", "cold": "Not Offered", "init": "In It", "fav2": "Favorite",
                                 "fav1": "Favorite", "favtie": "Favorite", "yours": "Yours"}, ladder[1]
            assert ladder[0] == ["yours", "favtie", "fav1", "fav2", "lead", "init", "trail", "cold", "lost"], ladder[0]
            assert_chance_order(page, v["board"], "smu")
            # the search narrows the list live (name, position or state)
            token = v["board"][0]["name"].split()[-1]
            page.fill("#rc-search", token)
            time.sleep(0.6)
            want = {b["id"] for b in v["board"] if token.lower() in b["name"].lower() or token.lower() == b["position"].lower() or token.upper() == (b["hometown"] or {}).get("state")}
            shown = set(page.eval_on_selector_all(".go-row-recruit", "els => els.map(e => e.dataset.pid)"))
            assert shown == want, (shown, want)
            page.fill("#rc-search", "")
            time.sleep(0.6)
            assert page.evaluate("() => document.querySelectorAll('.go-row-recruit').length") == board_n
            # picking a row fills the pane: his name, the chip with his stage, the strip, the tags, the sub-tabs; no pitch list, no action grid
            pid = v["board"][1]["id"]
            b = next(x for x in v["board"] if x["id"] == pid)
            page.click(f".go-row-recruit[data-pid='{pid}']")
            time.sleep(0.6)
            assert page.get_attribute(f".go-row-recruit[data-pid='{pid}']", "aria-pressed") == "true"
            assert b["name"] in page.inner_text(".go-pane .go-pane-head")
            STAGE_WORD = {"cold": "Cold", "contact": "In Touch", "top": "Top 8", "visited": "Visited"}
            assert page.text_content(".go-pane .go-chip").strip() == STAGE_WORD.get(b["stage"], "Cold"), page.text_content(".go-pane .go-chip")
            box = page.evaluate("() => { const p = document.querySelector('.go-pane'); const r = p.getBoundingClientRect(); return [r.top, r.bottom, getComputedStyle(p).position]; }")
            assert box[2] == "sticky" and 0 <= box[0] < 400, box
            # the pane sticks: scrolled down a long board, it is still on screen beside the list
            assert board_n >= 20, f"the sticky check needs a long board: {board_n} rows"
            page.evaluate("() => window.scrollTo(0, 1500)")
            time.sleep(0.3)
            top = page.evaluate("() => [window.scrollY, document.querySelector('.go-pane').getBoundingClientRect().top]")
            assert top[0] >= 1000 and 0 <= top[1] <= 200, f"the pane stays in view while the board scrolls: scrollY, pane top = {top}"
            shot(page, "pane-sticky-1280-dark")
            page.evaluate("() => window.scrollTo(0, 0)")
            time.sleep(0.2)
            assert page.evaluate("() => document.querySelectorAll('.go-pane .go-strip .go-stat').length") == 4, "four stat cells"
            assert page.eval_on_selector_all(".go-pane .go-subtabs button[data-sub]", "els => els.map(e => e.dataset.sub)") == ["overview", "scouting", "profile", "history"]
            assert page.query_selector(".go-pane .go-sub-body .go-race"), "Overview draws his list as a race"
            assert not page.query_selector(".go-pane .go-pitch, .go-pane .go-act, .go-pane .go-actions, .go-pane .go-nil"), "nothing is shown for an interaction you are not having"
            # the row's word, the strip's odds and the Overview sentence come from the one ladder
            sd = page.evaluate("([b, me]) => window.CFP.recruiting.standingOf(b, me)", [b, "smu"])
            assert page.inner_text(f".go-row-recruit[data-pid='{pid}'] .go-standing-word").strip() == sd["word"]
            assert sd["text"] in page.inner_text(".go-pane .go-sub-body"), (sd, page.inner_text(".go-pane .go-sub-body"))
            assert (sd.get("odds") or "—") in page.inner_text(".go-pane .go-strip")
            shot(page, "pane-1280-dark")
            # sub-tabs: Scouting, Profile inline (no modal), History with this week's contacts
            page.click(".go-subtabs button[data-sub=scouting]")
            time.sleep(0.3)
            assert page.get_attribute(".go-subtabs button[data-sub=scouting]", "aria-selected") == "true"
            page.click(".go-subtabs button[data-sub=profile]")
            page.wait_for_selector(".go-pane .go-sub-body.go-profile h3", timeout=60_000)
            assert not page.query_selector(".modal:not([hidden])"), "the profile draws inline, not in a modal"
            # the pane's head already carries him: the inline profile draws no second head (avatar, name, stars, school, rankings)
            assert not page.query_selector(".go-pane .go-sub-body .go-profile-head, .go-pane .go-sub-body h2.go-display"), "the pane's Profile repeats his head"
            # the menu holds every action: the inline profile carries no scout button and no on-board toggle
            prof_btns = page.eval_on_selector_all(".go-pane .go-sub-body button", "els => els.map(e => e.textContent)")
            assert not [x for x in prof_btns if "scout" in x.lower() or "board" in x.lower()], f"the inline profile acts outside the menu: {prof_btns}"
            page.click(".go-subtabs button[data-sub=history]")
            time.sleep(0.3)
            if "history" in b:      # the contact log: an untouched recruit reads the empty line
                assert page.inner_text(".go-pane .go-sub-body").strip() == HISTORY_EMPTY, page.inner_text(".go-pane .go-sub-body")
            else:                   # before the server logs contacts: this week's contacts
                assert "Contacts this week" in page.inner_text(".go-pane .go-sub-body")
            # a History row reads Week n · what you did · the pitch · his reaction (a call's pitch folds into the call), newest first
            lines = page.evaluate("""() => window.CFP.recruiting.historyLines([
              { week: 6, kind: "commit", school: "georgia" },
              { week: 5, kind: "offer", nil: 120, school: "smu" },
              { week: 4, kind: "pitch", pitch: "prestige", reaction: "hit" },
              { week: 4, kind: "contact", action: "call" },
              { week: 3, kind: "contact", action: "message", pitch: "playing_time" },
              { week: 2, kind: "offer", school: "georgia" },
            ], "smu")""")
            assert lines == ["Week 6 · Committed to Georgia", "Week 5 · Offer · 120 NIL", "Week 4 · Call · Program Prestige · He lit up",
                             "Week 3 · Message · Playing Time", "Week 2 · Offered by Georgia"], lines
            page.click(".go-subtabs button[data-sub=overview]")
            # the Recruit menu: nine items, the unavailable ones grayed with the reason as a second line
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu[role=menu]")
            assert page.get_attribute("#rc-recruit", "aria-expanded") == "true"
            items = page.eval_on_selector_all(".go-menu .go-menu-item", "els => els.map(e => [e.dataset.action, e.getAttribute('aria-disabled') === 'true', (e.querySelector('.go-menu-why') || {}).textContent || ''])")
            assert [i[0] for i in items] == ["message", "call", "hc_visit", "scout", "official_visit", "offer", "raise_nil", "pull_offer", "off_board"], items
            assert all(bool(i[2]) == i[1] for i in items), f"a disabled item says why, an enabled one does not: {items}"
            by = {i[0]: i for i in items}
            assert by["raise_nil"][1] and by["pull_offer"][1] and by["official_visit"][1], "before an offer: no raise, no pull, no visit"
            assert not by["message"][1] and not by["offer"][1] and not by["off_board"][1], items
            assert page.evaluate("() => document.activeElement.classList.contains('go-menu-item')"), "the menu takes focus"
            shot(page, "menu-1280-dark")
            page.keyboard.press("Escape")
            assert not page.query_selector(".go-menu"), "Escape closes the menu"
            assert page.evaluate("() => document.activeElement.id") == "rc-recruit", "focus returns to the button"
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu[role=menu]")
            assert page.evaluate("() => [...document.querySelectorAll('.go-menu .go-menu-item')].every(e => !e.disabled)"), "a grayed item is aria-disabled, not disabled"
            page.keyboard.press("End")
            assert page.evaluate("() => document.activeElement.dataset.action") == "off_board"
            page.keyboard.press("ArrowUp")
            assert page.evaluate("() => document.activeElement.dataset.action") == "pull_offer", "the arrow keys reach a grayed item and its reason"
            page.keyboard.press("Enter")
            assert page.query_selector(".go-menu"), "a grayed item ignores activation"
            page.keyboard.press("Tab")
            assert not page.query_selector(".go-menu"), "Tab closes the menu"
            assert page.evaluate("() => document.activeElement.id") == "rc-recruit", "Tab returns focus to the button"
            # Message opens the step: the pitch dropdown with his known priorities first; Send posts and the step closes
            page.click("#rc-recruit")
            page.click(".go-menu .go-menu-item[data-action=message]")
            page.wait_for_selector(".go-pane .go-step select#rc-pitch")
            assert not page.query_selector(".go-menu")
            opts = page.eval_on_selector_all("#rc-pitch option", "o => o.map(x => [x.value, x.textContent])")
            known = b["priorities_known"]
            assert [o[0] for o in opts[:len(known)]] == known and all(o[1].startswith("★ ") for o in opts[:len(known)]), (opts, known)
            assert not any(o[1].startswith(("★", "☆")) for o in opts[len(known):]), f"no star without a priority or a cue: {opts}"
            msg_pitch = page.eval_on_selector("#rc-pitch", "s => s.value")
            if known:
                assert page.eval_on_selector("#rc-pitch", "s => s.value") == known[0], "the default is his first known priority"
            assert not page.query_selector(".go-pane .go-step #rc-nil"), "a message carries no NIL field"
            assert page.inner_text(".go-pane .go-step button.go-step-go").strip() == "Send"
            shot(page, "step-1280-dark")
            hours = call(base, f"/api/season/{A}/recruiting")["hours_left"]
            n = draws(page)
            page.click(".go-pane .go-step button.go-step-go")
            settle(page, n)
            assert not page.query_selector(".go-pane .go-step"), "the step closes once the message is sent"
            assert call(base, f"/api/season/{A}/recruiting")["hours_left"] == hours - 5, "the message went out"
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu")
            assert page.inner_text(".go-menu-item[data-action=message] .go-menu-why").strip() == "Once a week"
            page.keyboard.press("Escape")
            # Offer… opens the same step with the NIL field and the lowball line; Cancel closes it
            page.click("#rc-recruit")
            page.click(".go-menu .go-menu-item[data-action=offer]")
            page.wait_for_selector(".go-pane .go-step input#rc-nil")
            assert page.query_selector(".go-pane .go-step select#rc-pitch") and "lowball" in page.inner_text(".go-pane .go-step")
            assert page.inner_text(".go-pane .go-step button.go-step-go").strip() == "Offer"
            page.click(".go-pane .go-step button.go-step-cancel")
            assert not page.query_selector(".go-pane .go-step")
            # Call plays as a scene in the pane: his lines, the cue marks a pitch, Pitch shows his reaction; the row keeps only its word
            n = draws(page)
            page.click("#rc-recruit")
            page.click(".go-menu .go-menu-item[data-action=call]")
            present_three(page)
            page.wait_for_selector(".go-pane .go-scene .go-scene-line.cue", timeout=30_000)
            settle(page, n)
            # the cue marks its pitch with a hollow star (a known priority keeps the full one); the old tag's word is gone
            cue = next(x for x in call(base, f"/api/season/{A}/recruiting")["board"] if x["id"] == pid)["scene"]["cue"]["topics"]
            known_now = next(x for x in call(base, f"/api/season/{A}/recruiting")["board"] if x["id"] == pid)["priorities_known"]
            tags = dict(page.eval_on_selector_all(".go-pane .go-pitch", "els => els.map(e => [e.querySelector('input').value, e.querySelector('.go-tag').textContent])"))
            for t in cue:
                assert tags[t].startswith("★" if t in known_now else "☆"), (t, tags)
            assert page.query_selector(".go-pane .go-pitch.cue .go-tag"), "the cue marks a pitch"
            assert page.eval_on_selector(".go-pane .go-pitch.cue .go-tag", "e => e.textContent").startswith("☆")
            assert page.eval_on_selector(".go-pane .go-pitch.cue .go-tag", "e => e.title") == CUE_TITLE
            assert GONE not in page.inner_text("body"), "the old tag's word is gone"
            assert not page.query_selector("#rc-finish"), "Finish stays out of the head while the scene is on screen"
            assert "primary" not in (page.get_attribute("#rc-recruit", "class") or ""), "Recruit steps back while the call plays"
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu")
            whys = page.eval_on_selector_all(".go-menu .go-menu-item", "els => els.map(e => [e.getAttribute('aria-disabled') === 'true', (e.querySelector('.go-menu-why') || {}).textContent || ''])")
            assert len(whys) == 9 and all(d and w == "Finish your call first" for d, w in whys), whys
            page.keyboard.press("Escape")
            shot(page, "scene-1280-dark")
            priorities = season.load_season(A)["recruiting"]["prospects"][pid]["priorities"]
            hit = next(t for t in cue if t in priorities)
            page.click(f".go-pane .go-pitch:has(input[value='{hit}'])")
            n = draws(page)
            page.click(".go-pane button:has-text('Pitch')")
            page.wait_for_selector(".go-pane .go-reaction", timeout=30_000)
            kind = page.get_attribute(".go-pane .go-reaction", "data-kind")
            assert kind in ("hit", "polite", "quiet"), kind
            assert not page.query_selector(f".go-row-recruit[data-pid='{pid}'] .go-tag"), "the row keeps nothing but the word"
            def one_star(where):
                """The pitched topic is known and cued: one tag, the full star; the other side of a two-sided cue stays hollow."""
                ts = page.eval_on_selector_all(".go-pane .go-tags .go-tag", "els => els.map(e => [e.textContent, e.className, e.title])")
                named = [x for x in ts if x[0].endswith(PITCH[hit])]
                assert len(named) == 1 and named[0][0] == f"★ {PITCH[hit]}" and "cue" not in named[0][1], (where, ts)
                for t in cue:
                    if t != hit:
                        assert [f"☆ {PITCH[t]}", CUE_TITLE] in [[x[0], x[2]] for x in ts if "cue" in x[1]], (where, t, ts)
                assert GONE not in page.inner_text("body"), where
            one_star("after his reaction")
            toasted(page, f"Pitch: {PITCH[hit]} · {REACTION[kind]}")
            settle(page, n)   # the reaction stays four seconds, then the board re-fetches
            assert page.query_selector(".go-pane .go-scene .go-reaction"), "the finished conversation stays on screen after the board catches up"
            one_star("after the re-render")
            # the Offer step's pitch list: his known priorities wear ★, the cued topic he named among them (never both)
            page.click("#rc-recruit")
            page.click(".go-menu .go-menu-item[data-action=offer]")
            page.wait_for_selector(".go-pane .go-step select#rc-pitch")
            opts = dict(page.eval_on_selector_all("#rc-pitch option", "o => o.map(x => [x.value, x.textContent])"))
            assert opts[hit].startswith(f"★ {PITCH[hit]}") and "☆" not in opts[hit], opts
            for t in cue:
                if t != hit:
                    assert opts[t].startswith(f"☆ {PITCH[t]}"), opts
            page.click(".go-pane .go-step button.go-step-cancel")
            # History: the message you sent and the call with its pitch and his reaction (once the server logs contacts)
            row_now = next(x for x in call(base, f"/api/season/{A}/recruiting")["board"] if x["id"] == pid)
            if "history" in row_now:
                page.click(".go-subtabs button[data-sub=history]")
                time.sleep(0.3)
                hist = page.inner_text(".go-pane .go-sub-body")
                wk = season.load_season(A)["current_week"]
                assert f"Week {wk} · Message · {PITCH[msg_pitch]}" in hist, hist
                assert f"Week {wk} · Call · {PITCH[hit]} · {REACTION[kind]}" in hist, hist
                page.click(".go-subtabs button[data-sub=overview]")
            assert not page.query_selector("#rc-finish"), "a finished call leaves the head"
            # a second recruit's call: the menu waits, Hang up closes the scene and Finish stays in the head
            order = page.eval_on_selector_all(".go-row-recruit", "els => els.map(e => e.dataset.pid)")
            second = next(x for x in order if x != pid)
            page.click(f".go-row-recruit[data-pid='{second}']")
            time.sleep(0.6)
            n = draws(page)
            page.click("#rc-recruit")
            page.click(".go-menu .go-menu-item[data-action=call]")
            present_three(page)
            page.wait_for_selector(".go-pane .go-scene .go-scene-line.cue", timeout=30_000)
            settle(page, n)
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu")
            assert page.eval_on_selector_all(".go-menu .go-menu-item", "els => els.every(e => e.getAttribute('aria-disabled') === 'true' && e.querySelector('.go-menu-why').textContent === 'Finish your call first')")
            page.keyboard.press("Escape")
            page.click(".go-pane .go-scene button:has-text('Hang Up')")
            time.sleep(0.5)
            assert not page.query_selector(".go-pane .go-scene"), "hanging up closes the scene view"
            assert page.query_selector("#rc-finish"), "the call stays open: Finish stays in the head"
            # the pane shows what he said: a hollow star per cued topic he has not confirmed, titled for the call
            cue2 = next(x for x in call(base, f"/api/season/{A}/recruiting")["board"] if x["id"] == second)
            hollow = page.eval_on_selector_all(".go-pane .go-tags .go-tag.cue", "els => els.map(e => [e.textContent, e.title])")
            assert hollow == [[f"☆ {PITCH[t]}", CUE_TITLE] for t in cue2["scene"]["cue"]["topics"] if t not in cue2["priorities_known"]], hollow
            assert hollow, "an unconfirmed cue shows as ☆"
            # arrow keys move the selection down the list and back
            page.focus(f".go-row-recruit[data-pid='{second}']")
            page.keyboard.press("ArrowDown")
            time.sleep(0.5)
            after = order[order.index(second) + 1]
            assert page.eval_on_selector_all(".go-row-recruit[aria-pressed=true]", "els => els.map(e => e.dataset.pid)") == [after], "ArrowDown selects the next row"
            assert page.evaluate("() => document.activeElement.dataset.pid") == after
            page.keyboard.press("ArrowUp")
            time.sleep(0.5)
            assert page.eval_on_selector_all(".go-row-recruit[aria-pressed=true]", "els => els.map(e => e.dataset.pid)") == [second]
            assert page.query_selector("#rc-finish")
            assert not errors, errors

            # --- The footprint map: a dot per board prospect, 51 states, a state tap filters the list, a table alternative, hidden on a tiny screen
            open_tab(page, base, A, "recruiting", ".go-stages")
            # the map is closed until you open it: one slim row with a toggle that says what it does
            assert page.evaluate("() => document.querySelector('.go-map-body').hidden"), "the map starts closed"
            assert "Show" in page.inner_text(".go-map .go-map-toggle") and page.get_attribute(".go-map .go-map-toggle", "aria-expanded") == "false"
            assert page.evaluate("() => document.querySelector('.go-map').getBoundingClientRect().height") < 90, "closed, the map card is one slim row"
            page.click(".go-map .go-map-toggle")
            assert not page.evaluate("() => document.querySelector('.go-map-body').hidden") and "Hide" in page.inner_text(".go-map .go-map-toggle")
            dots = page.evaluate("() => document.querySelectorAll('.go-map .us-dot').length")
            board = page.evaluate("() => document.querySelectorAll('.go-row-recruit').length")
            assert dots == board, (dots, board)
            assert page.evaluate("() => document.querySelectorAll('.go-map .us-state').length") == 51
            # every dot sits on the canvas (a hometown without coordinates falls back to its state's center)
            assert page.evaluate("() => [...document.querySelectorAll('.go-map .us-dot')].every(c => { const x = +c.getAttribute('cx'), y = +c.getAttribute('cy'); return x > 0 && y > 0 && x < 975 && y < 610; })")
            # a dot picks him even when the stage tab hides him: the board goes back to All with him selected
            vb = call(base, f"/api/season/{A}/recruiting")["board"]
            cold = next((b for b in vb if b["stage"] == "cold" and not b["committed"] and not b["signed"]), None)
            if cold and any(b["stage"] == "contact" for b in vb):
                page.click(".go-stages button[data-stage=contact]")
                time.sleep(0.4)
                assert not page.query_selector(f".go-row-recruit[data-pid='{cold['id']}']"), "the In touch tab hides a cold recruit"
                page.eval_on_selector(f".go-map .us-dot[data-id='{cold['id']}']", "e => e.dispatchEvent(new MouseEvent('click', { bubbles: true }))")
                time.sleep(0.8)
                assert page.eval_on_selector_all(".go-row-recruit[aria-pressed=true]", "els => els.map(e => e.dataset.pid)") == [cold["id"]], "the dot's recruit is selected"
                assert page.get_attribute(".go-stages button[data-stage=all]", "aria-pressed") == "true", "the tab that hid him gives way to All"
            # the table tells us which state holds the most of his board; tap that one
            page.click(".go-map button:has-text('List the States')")
            assert page.query_selector(".go-map-table tr"), "an accessible table alternative"
            top = page.evaluate("() => { const rows = [...document.querySelectorAll('.go-map-table tbody tr')].map(r => [r.querySelector('th').textContent, +r.querySelector('td').textContent]); rows.sort((a, b) => b[1] - a[1]); return rows[0]; }")
            st, n = top
            assert n >= 1 and n < board or n == board, top
            page.click(f".go-map .us-state[data-state='{st}']")
            time.sleep(0.6)
            assert page.evaluate("() => document.querySelectorAll('.go-row-recruit').length") == n, "a state tap filters the list to that state's prospects"
            assert page.query_selector(f".go-map .us-state.selected[data-state='{st}']"), "the tapped state is outlined"
            page.click(f".go-map .us-state[data-state='{st}']")
            time.sleep(0.6)
            assert page.evaluate("() => document.querySelectorAll('.go-row-recruit').length") == board, "tapping again clears the filter"
            # --- Map zoom: a state tap zooms to its box (and filters), labels its dots, keeps dots one screen size; again resets
            FULL_VB = "0 0 975 610"
            map_vb = lambda: page.get_attribute(".go-map svg.us-map", "viewBox")
            map_box = lambda: [float(x) for x in re.split(r"[\s,]+", map_vb().strip())]
            n_rows = lambda: page.evaluate("() => document.querySelectorAll('.go-row-recruit').length")
            home = lambda b: (b.get("hometown") or {}).get("state")
            assert map_vb() == FULL_VB, map_vb()
            zst = "TX" if any(home(b) == "TX" for b in vb) else st
            in_st = {b["id"] for b in vb if home(b) == zst}
            dot_px = lambda pid: page.eval_on_selector(f".go-map .us-dot[data-id='{pid}']", "e => e.getBoundingClientRect().width")
            some = sorted(in_st)[0]
            px_full = dot_px(some)
            page.click(f".go-map .us-state[data-state='{zst}']")
            time.sleep(0.6)
            x, y, w, h = map_box()
            cx, cy = page.evaluate("(c) => USMap.centroid(c)", zst)
            assert w < 0.4 * 975 and x <= cx <= x + w and y <= cy <= y + h, f"a state tap zooms to its box: {(x, y, w, h)} around {(cx, cy)}"
            assert n_rows() == len(in_st), "the same tap filters the list to the state's prospects"
            labels = page.eval_on_selector_all(".go-map .us-dots text", "els => els.map(e => [e.dataset.id, e.textContent, e.getBoundingClientRect().height])")
            names = {b["id"]: b["name"] for b in vb}
            assert in_st <= {i for i, _, _ in labels}, "every dot of the zoomed state carries its name"
            assert all(t == names[i] for i, t, _ in labels), "a label is the recruit's name"
            assert all(8 <= hh <= 22 for _, _, hh in labels), f"labels read at a normal text size: {[hh for _, _, hh in labels][:5]}"
            in_view = page.evaluate("""() => { const r = document.querySelector('.go-map svg.us-map').getBoundingClientRect();
              return [...document.querySelectorAll('.go-map .us-dot')].filter(c => { const b = c.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
                return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }).map(c => c.dataset.id); }""")
            assert {i for i, _, _ in labels} == set(in_view), "the labels are the dots in view, no more"
            # a cluster's names step aside rather than print over each other (one with no room waits for a closer zoom)
            boxes = page.eval_on_selector_all(".go-map .us-dots text.us-label:not(.crowded)", "els => els.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })")
            assert boxes, "some labels show"
            hits = [(a, b) for i, a in enumerate(boxes) for b in boxes[i + 1:] if a[0] < b[2] - 1 and b[0] < a[2] - 1 and a[1] < b[3] - 1 and b[1] < a[3] - 1]
            assert not hits, f"labels overlap: {hits[:3]}"
            assert abs(dot_px(some) - px_full) <= 1, f"a dot keeps its screen size at zoom: {dot_px(some)} vs {px_full}"
            page.click(f".go-map .us-state[data-state='{zst}']")
            time.sleep(0.6)
            assert map_vb() == FULL_VB, f"tapping again resets the view: {map_vb()}"
            assert n_rows() == board and not page.query_selector(".go-map .us-dots text"), "and clears the filter and the labels"
            # Escape resets the zoom and the filter (focus comes back to the state after the board redraws)
            page.click(f".go-map .us-state[data-state='{zst}']")
            time.sleep(0.6)
            assert n_rows() == len(in_st)
            page.keyboard.press("Escape")
            time.sleep(0.6)
            assert map_vb() == FULL_VB and n_rows() == board, "Escape resets the zoom and clears the filter"
            # the region buttons: one per scouting area, the scout's name on a covered one; a region zooms, no filter
            rv = call(base, f"/api/season/{A}/recruiting")
            areas = rv["areas"]
            staffed = {m["area"]: m["name"] for m in rv.get("staff") or [] if m.get("area")}
            regs = page.eval_on_selector_all(".go-map-regions button[data-area]", "els => els.map(e => [e.dataset.area, e.textContent, e.getAttribute('aria-pressed')])")
            assert [a for a, _, _ in regs] == list(areas), regs
            assert all((staffed[a] in t) if a in staffed else t == a for a, t, _ in regs), regs
            assert all(p == "false" for _, _, p in regs)
            ri = max(range(len(regs)), key=lambda i: len(areas[regs[i][0]]))
            ra = regs[ri][0]
            page.click(f".go-map-regions button[data-area] >> nth={ri}")
            time.sleep(0.6)
            x, y, w, h = map_box()
            cents = page.evaluate("(cs) => cs.map(c => USMap.centroid(c))", areas[ra])
            assert w < 975 and all(x <= a <= x + w and y <= b <= y + h for a, b in cents), f"a region zooms to a box holding its states: {(x, y, w, h)}"
            assert page.get_attribute(f".go-map-regions button[data-area] >> nth={ri}", "aria-pressed") == "true"
            assert n_rows() == board, "a region is not a filter"
            page.click(".go-map-regions .go-map-reset")
            time.sleep(0.6)
            assert map_vb() == FULL_VB and page.get_attribute(f".go-map-regions button[data-area] >> nth={ri}", "aria-pressed") == "false", "Whole country resets"
            # the wheel zooms around the pointer: the point under it stays put; it never zooms out past the whole map
            page.eval_on_selector(".go-map svg.us-map", "e => e.scrollIntoView({ block: 'center' })")
            at = """() => { const s = document.querySelector('.go-map svg.us-map'); const [x, y] = USMap.centroid('MO');
              const p = new DOMPoint(x, y).matrixTransform(s.getScreenCTM()); return [p.x, p.y]; }"""
            p0 = page.evaluate(at)
            page.mouse.move(p0[0] + 0.0, p0[1] + 0.0)
            page.mouse.wheel(0, -300)
            time.sleep(0.4)
            p1 = page.evaluate(at)
            assert map_box()[2] < 975, f"the wheel zooms in: {map_vb()}"
            assert abs(p1[0] - p0[0]) <= 2 and abs(p1[1] - p0[1]) <= 2, f"the point under the pointer stays put: {p0} -> {p1}"
            page.mouse.wheel(0, 3000)
            time.sleep(0.4)
            assert map_vb() == FULL_VB, f"zooming out stops at the whole map: {map_vb()}"
            # a wheel burst over a zoomed state lays the labels out once, when it settles (not on every tick)
            page.click(f".go-map .us-state[data-state='{zst}']")
            time.sleep(0.6)
            page.evaluate("""() => { window.__labelBatches = 0; const g = document.querySelector('.go-map .us-dots');
              new MutationObserver(() => { window.__labelBatches++; }).observe(g, { childList: true }); }""")
            mid = page.eval_on_selector(".go-map svg.us-map", "e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
            page.mouse.move(*mid)
            for _ in range(10):
                page.mouse.wheel(0, -40)
            time.sleep(0.5)
            batches = page.evaluate("() => window.__labelBatches")
            assert batches <= 1, f"a ten-tick wheel burst relaid the labels {batches} times"
            assert page.query_selector(".go-map .us-dots text.us-label") and not page.query_selector(".go-map svg.us-map.moving"), "the labels are back once it settles"
            page.keyboard.press("Escape")
            time.sleep(0.6)
            assert map_vb() == FULL_VB and n_rows() == board, "Escape after the burst resets both"
            # the keyboard: + zooms in on the focused map, Escape resets; a state is a button with its name and count
            page.focus(".go-map svg.us-map")
            page.keyboard.press("+")
            time.sleep(0.4)
            assert map_box()[2] < 975, "+ zooms in"
            page.keyboard.press("Escape")
            time.sleep(0.4)
            assert map_vb() == FULL_VB, "Escape resets"
            lab = page.eval_on_selector(f".go-map .us-state[data-state='{zst}']", "e => [e.getAttribute('tabindex'), e.getAttribute('role'), e.getAttribute('aria-label')]")
            assert lab[0] == "0" and lab[1] == "button" and str(len(in_st)) in lab[2], lab
            page.focus(f".go-map .us-state[data-state='{zst}']")
            page.keyboard.press("Enter")
            time.sleep(0.6)
            assert n_rows() == len(in_st) and map_box()[2] < 0.4 * 975, "Enter on a state zooms and filters"
            page.keyboard.press("Escape")
            time.sleep(0.6)
            assert map_vb() == FULL_VB and n_rows() == board
            # your choice is remembered across a reload, both ways
            open_tab(page, base, A, "recruiting", ".go-stages")
            assert not page.evaluate("() => document.querySelector('.go-map-body').hidden"), "an opened map stays open"
            page.click(".go-map .go-map-toggle")
            open_tab(page, base, A, "recruiting", ".go-stages")
            assert page.evaluate("() => document.querySelector('.go-map-body').hidden") and "Show" in page.inner_text(".go-map .go-map-toggle"), "a closed map stays closed"
            page.click(".go-map .go-map-toggle")
            assert not page.evaluate("() => document.querySelector('.go-map-body').hidden")
            page.set_viewport_size({"width": 340, "height": 700})
            open_tab(page, base, A, "recruiting", ".go-stages")
            assert not page.query_selector(".go-map svg"), "the map's picture is left out under 360px"
            assert page.evaluate("() => document.querySelectorAll('.go-stages button[data-stage]').length") == 6, "the board still renders its stage tabs"
            page.click(".go-map button:has-text('List the States')")
            assert page.query_selector(".go-map-table tr"), "the table is still reachable on a tiny screen"
            page.click(".go-map .go-map-toggle")
            # a phone: the region row scrolls sideways inside itself (the page does not), and a region button still zooms
            page.set_viewport_size({"width": 400, "height": 860})
            open_tab(page, base, A, "recruiting", ".go-stages")
            if page.evaluate("() => document.querySelector('.go-map-body').hidden"):
                page.click(".go-map .go-map-toggle")
            row = page.eval_on_selector(".go-map-regions", "e => [getComputedStyle(e).overflowX, e.scrollWidth, e.clientWidth, getComputedStyle(e).flexWrap]")
            assert row[0] == "auto" and row[3] == "nowrap" and row[1] > row[2], f"the region row scrolls on a phone: {row}"
            assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways page scroll with the map open"
            page.click(".go-map-regions button[data-area] >> nth=-1")
            time.sleep(0.6)
            assert map_box()[2] < 975, "a region button zooms on a phone"
            page.click(".go-map .go-map-toggle")
            page.set_viewport_size({"width": 1280, "height": 1000})

            # --- The pane's Profile sub-tab: no second head, grade cards inside the pane, the sub-tab strip pinned while it scrolls
            check_pane_profile(page, base, A)

            # --- A phone: the list fills the width, a row opens the pane full-screen with a back button, the menu is a bottom sheet
            page.set_viewport_size({"width": 400, "height": 860})
            open_tab(page, base, A, "recruiting", ".go-stages")
            assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways page scroll on a phone"
            assert not page.query_selector(".go-pane"), "on a phone the pane waits for a tap"
            shot(page, "board-400-dark")
            first = page.get_attribute(".go-row-recruit >> nth=0", "data-pid")
            page.click(f".go-row-recruit[data-pid='{first}']")
            time.sleep(0.6)
            sheet = page.evaluate("() => { const p = document.querySelector('.go-pane.sheet'); if (!p) return null; const r = p.getBoundingClientRect(); return [r.top, r.bottom, window.innerHeight, p.getAttribute('role')]; }")
            assert sheet and sheet[3] == "dialog" and sheet[0] <= 1 and sheet[1] >= sheet[2] - 1, f"the pane is a full-screen dialog: {sheet}"
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu.sheet[role=menu]")
            assert page.evaluate("() => document.querySelectorAll('.go-menu .go-menu-item').length") == 9
            shot(page, "menu-400-dark")
            page.keyboard.press("Escape")
            assert not page.query_selector(".go-menu")
            shot(page, "pane-400-dark")
            page.click(".go-pane .go-pane-back")
            assert not page.query_selector(".go-pane.sheet")
            assert page.evaluate("() => document.activeElement.dataset.pid") == first, "back returns to the row"
            # a scene open on a phone survives a resize to a desktop: the call hung up earlier resumes from Finish
            page.click(f".go-row-recruit[data-pid='{second}']")
            time.sleep(0.6)
            n = draws(page)
            page.click("#rc-finish")
            settle(page, n)
            page.wait_for_selector(".go-pane.sheet .go-scene .go-scene-line.cue", timeout=30_000)
            shot(page, "scene-400-dark")
            page.set_viewport_size({"width": 1280, "height": 1000})
            page.wait_for_selector(".go-pane:not(.sheet) .go-scene", timeout=10_000)
            page.click(".go-pane .go-scene button:has-text('Hang Up')")
            time.sleep(0.4)
            # the light theme, for the screenshots
            page.evaluate("() => { document.documentElement.dataset.theme = 'light'; try { localStorage.setItem('cfp.theme', 'light'); } catch (e) {} }")
            time.sleep(0.4)
            shot(page, "board-1280-light")
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu")
            shot(page, "menu-1280-light")
            page.keyboard.press("Escape")
            page.set_viewport_size({"width": 400, "height": 860})
            time.sleep(0.5)
            shot(page, "board-400-light")
            page.evaluate("() => { delete document.documentElement.dataset.theme; try { localStorage.removeItem('cfp.theme'); } catch (e) {} }")
            page.set_viewport_size({"width": 1280, "height": 1000})
            assert not errors, errors

            # --- The finished career's board: the Committed tab holds yours (no menu) and the ones you lost (no menu, the chip says so)
            signed = call(base, f"/api/season/{B}/prospects?status=signed&limit=200")["rows"]
            lost_pid = next(r["id"] for r in signed if r["signed"] != "ohio-state")
            mine_pid = next(r["id"] for r in signed if r["signed"] == "ohio-state")
            for pid in (lost_pid, mine_pid, verbal_pid, hard_pid, hard_noffer_pid):
                call(base, f"/api/season/{B}/board", {"pid": pid, "on": True})
            # the board's filters belong to one career: a position, a state and a search set in this one are gone in the next
            open_tab(page, base, A, "recruiting", ".go-stages")
            if page.evaluate("() => document.querySelector('#rc-needs').hidden"):
                page.click(".go-needs-toggle")
            page.click("#rc-needs .go-needs .go-chip >> nth=0")
            time.sleep(0.4)
            assert page.query_selector(".go-needs-toggle .go-tag"), "a position picked from the needs filters the board"
            if page.evaluate("() => document.querySelector('.go-map-body').hidden"):
                page.click(".go-map .go-map-toggle")
            page.eval_on_selector(".go-map .us-state >> nth=0", "e => e.dispatchEvent(new MouseEvent('click', { bubbles: true }))")
            time.sleep(0.4)
            assert page.query_selector(".go-map .us-state.selected"), "a state picked on the map filters the board"
            page.fill("#rc-search", "zzzz")
            time.sleep(0.6)
            assert not page.query_selector(".go-row-recruit")
            ids = [x["id"] for x in call(base, "/api/seasons")["seasons"]]
            page.eval_on_selector(f"#season-list li >> nth={ids.index(B)}", "e => e.click()")      # in place: no reload
            page.wait_for_function("(id) => location.search.includes(id)", arg=B, timeout=60_000)
            page.click("#season-tabs button[data-tab=recruiting]")
            page.wait_for_selector(".go-stages", timeout=120_000)
            time.sleep(0.8)
            vb = call(base, f"/api/season/{B}/recruiting")["board"]
            assert not page.query_selector(".go-needs-toggle .go-tag"), "another career's position filter is not carried over"
            assert page.eval_on_selector("#rc-search", "e => e.value") == "", "another career's search is not carried over"
            assert not page.query_selector(".go-map .us-state.selected"), "another career's state filter is not carried over"
            assert page.evaluate("() => document.querySelectorAll('.go-row-recruit').length") == len(vb), "the whole board shows in the new career"
            # sorted by your chance: yours first, the lost last
            shown = page.eval_on_selector_all(".go-row-recruit", "els => els.map(e => e.dataset.pid)")
            assert shown[0] == mine_pid and shown[-1] in (lost_pid, hard_pid, hard_noffer_pid), shown
            assert_chance_order(page, vb, "ohio-state")
            open_tab(page, base, B, "recruiting", ".go-stages")
            page.click(".go-stages button[data-stage=committed]")
            time.sleep(0.5)
            words = dict(page.eval_on_selector_all(".go-row-recruit", "els => els.map(e => [e.dataset.pid, e.querySelector('.go-standing-word').textContent.trim()])"))
            assert words[mine_pid] == "Yours" and words[lost_pid] == "Lost" and words[hard_pid] == "Lost" and words[hard_noffer_pid] == "Lost" and words[verbal_pid] in ("In It", "Long Shot"), words
            page.click(f".go-row-recruit[data-pid='{lost_pid}']")
            time.sleep(0.5)
            assert page.text_content(".go-pane .go-chip").startswith("Signed · ") and not page.query_selector("#rc-recruit"), "a prospect signed elsewhere has no Recruit menu"
            page.click(f".go-row-recruit[data-pid='{mine_pid}']")
            time.sleep(0.5)
            assert page.text_content(".go-pane .go-chip").strip() == "Signed With You" and not page.query_selector("#rc-recruit"), "a prospect who signed with you has no Recruit menu"
            # a verbal commit elsewhere can still be offered to try for a flip: the chip says so, the Overview talks of the flip, Offer is live
            page.click(f".go-row-recruit[data-pid='{verbal_pid}']")
            time.sleep(0.5)
            assert page.text_content(".go-pane .go-chip").startswith("Verbal Commit · ")
            assert "flip" in page.inner_text(".go-pane .go-sub-body"), page.inner_text(".go-pane .go-sub-body")
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu")
            assert not page.eval_on_selector(".go-menu-item[data-action=offer]", "e => e.getAttribute('aria-disabled') === 'true'"), "the Offer for a verbal commit elsewhere is live"
            page.click(".go-menu .go-menu-item[data-action=offer]")
            page.wait_for_selector(".go-pane .go-step input#rc-nil")
            page.click(".go-pane .go-step button.go-step-cancel")
            # a hard commit elsewhere with your offer out: no new offer, but you can pull yours back
            page.click(f".go-row-recruit[data-pid='{hard_pid}']")
            time.sleep(0.5)
            assert page.text_content(".go-pane .go-chip").startswith("Hard Commit · ")
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu")
            assert not page.eval_on_selector(".go-menu-item[data-action=pull_offer]", "e => e.getAttribute('aria-disabled') === 'true'"), "Pull offer is live for a hard commit elsewhere"
            # pulling asks first: the page's dialog handler dismisses it, so the offer stays
            n_dialogs = len(dialogs)
            page.click(".go-menu-item[data-action=pull_offer]")
            time.sleep(0.4)
            assert len(dialogs) == n_dialogs + 1 and dialogs[-1].startswith("Pull your offer to "), dialogs[-1:]
            assert any(b["id"] == hard_pid and b["offered"] for b in call(base, f"/api/season/{B}/recruiting")["board"]), "a dismissed confirm keeps the offer"
            if page.query_selector(".go-menu"): page.keyboard.press("Escape")
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu")
            assert page.inner_text(".go-menu-item[data-action=offer] .go-menu-why").strip() == "Already offered"
            page.keyboard.press("Escape")
            # the same without your offer: Offer… is grayed for the hard commit, and there is nothing to pull
            page.click(f".go-row-recruit[data-pid='{hard_noffer_pid}']")
            time.sleep(0.5)
            assert page.text_content(".go-pane .go-chip").startswith("Hard Commit · ")
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu")
            assert page.eval_on_selector(".go-menu-item[data-action=offer]", "e => e.getAttribute('aria-disabled') === 'true'")
            assert page.inner_text(".go-menu-item[data-action=offer] .go-menu-why").strip() == "Hard commit elsewhere"
            assert page.inner_text(".go-menu-item[data-action=pull_offer] .go-menu-why").strip() == "Not offered"
            page.keyboard.press("Escape")

            # --- Badges: a generational prospect wears the tag on the list; your class rows wear a badge or none
            open_tab(page, base, B, "classes", ".go-class")
            page.click(".go-class.yours .go-class-main")
            page.wait_for_selector(".go-class-list li", timeout=60_000)
            odd = page.evaluate("""() => [...document.querySelectorAll('.go-class-list li')].filter(li => {
                const b = li.querySelector('.go-badge'); return b && !b.matches('.generational, .gem-held, .bust-held, .gem-missed'); }).length""")
            assert odd == 0, f"{odd} class rows carry a badge that is not generational, held or missed"
            for sel, txt in ((".go-class-list .go-badge.gem-held", "Gem: The Read Held"), (".go-class-list .go-badge.bust-held", "Bust Risk: The Read Held"),
                             (".go-class-list .go-badge.gem-missed", "The Read Was Off")):
                for t in page.eval_on_selector_all(sel, "els => els.map(e => e.textContent.trim())"):
                    assert t == txt, f"{sel} reads {t!r}"
            # the Generational tag is your staff's to find: nobody wears it before three looks
            fives = call(base, f"/api/season/{A}/prospects?stars=5&limit=200")["rows"]
            unscouted = [r for r in fives if r["looks"] < 3]
            assert unscouted and not any(r.get("generational") for r in unscouted), "an unscouted prospect must not show the tag"
            open_tab(page, base, A, "prospects", ".go-list-row")
            page.select_option("select[aria-label=Stars]", "5")
            time.sleep(1.5)
            shown = page.eval_on_selector_all(".go-list-row", "rows => rows.filter(r => r.querySelector('.go-badge.generational')).map(r => r.querySelector('.go-list-id b').textContent)")
            assert all(any(r["name"] == n and r["looks"] >= 3 for r in fives) for n in shown), f"a badge on an unscouted five-star: {shown}"
            # scouting trips at the best unscouted five-star until his report is complete (a Send adds a look, or what is
            # left of the three), then the list agrees with the API either way
            pick = min((r for r in unscouted if r.get("can_scout")), key=lambda r: r["national_rank"], default=None)
            if pick and call(base, f"/api/season/{A}/recruiting")["hours_left"] >= 15:
                for _ in range(3):
                    if call(base, f"/api/season/{A}/prospect/{pick['id']}")["looks"] >= 3:
                        break
                    call(base, f"/api/season/{A}/recruit", {"pid": pick["id"], "action": "scout"})
                after = next(r for r in call(base, f"/api/season/{A}/prospects?stars=5&limit=200&q={urllib.parse.quote(pick['name'])}")["rows"] if r["id"] == pick["id"])
                assert after["looks"] >= 3
                page.fill("input[aria-label='Search by name']", pick["name"])
                time.sleep(1.5)
                badge = page.query_selector(".go-list-row .go-badge.generational")
                assert bool(badge) == bool(after.get("generational")), "after three looks the list shows the tag exactly when the API does"
                if badge:
                    assert badge.text_content().strip() == "Generational"

            # --- Scouting: the area picker looks like a picker
            open_tab(page, base, A, "scouting", ".sc-scout select")
            assert "go-sel" in (page.get_attribute(".sc-scout select", "class") or ""), "the scouting-area select is a house picker"

            # --- Schedule: the trade window says what the button does and names itself after the entry point
            open_tab(page, base, A, "schedule", ".schedule-pick")
            page.click(".schedule-pick button:has-text('Trade a Non-Conference Game')")
            page.wait_for_selector(".sched-edit-row", timeout=60_000)
            assert "Trade a Non-Conference Game" in page.inner_text(".modal-title >> visible=true")
            labels = page.evaluate("() => [...document.querySelectorAll('.sched-edit-row button')].map(b => b.textContent.trim())")
            assert labels and all(re.match(r"Trade (the )?[Ww]eek \d+", t) for t in labels), labels
            refused = page.evaluate("() => [...document.querySelectorAll('.sched-edit-row option')].filter(o => /· no:/.test(o.textContent)).map(o => o.disabled)")
            assert all(refused), "an option the other school refuses cannot be picked"
            page.keyboard.press("Escape")

            # --- Depth chart: its own screen at ?screen=depth. The tab opens it and Back returns; the formation's cards
            # pick a player whose depth controls are big enough to tap and named; your roster redshirts from the board;
            # class codes read as "RS Sr."; a link straight to the screen opens it
            for width in (1280, 400):
                page.set_viewport_size({"width": width, "height": 1000})
                open_tab(page, base, A, "depth", ".dc-card")
                assert "screen=depth" in page.url and page.is_hidden(".season-layout"), "the depth chart takes over the page"
                assert page.locator(".dc-card").count() == 11, "eleven on the field"
                page.click(".dc-card >> nth=0")
                page.wait_for_selector(".dc-depth-acts button", timeout=30_000)
                ctl = page.evaluate("""() => [...document.querySelectorAll('.dc-depth-acts button')].filter(b => b.offsetWidth).map(b => {
                    const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), op: getComputedStyle(b).opacity, label: b.getAttribute('aria-label') }; })""")
                small = [c for c in ctl if c["w"] < 24 or c["h"] < 24]
                assert not small, f"{width}px: depth controls under 24px: {small[:3]}"
                assert all(c["op"] == "1" for c in ctl), f"{width}px: depth controls are faint"
                assert all(c["label"] for c in ctl), "depth controls carry an aria-label"
                depth = page.inner_text("#depth-screen")
                assert not CLASS_CODE.search(depth), CLASS_CODE.search(depth).group(0)
                assert "null" not in depth.split(), "an empty value printed as null"
                # the units cycle, and the URL follows
                page.keyboard.press("]")
                page.wait_for_selector(".dc-cycle-name:has-text('Defense')", timeout=30_000)
                assert "unit=defense" in page.url
                # your roster redshirts from the board, both ways
                if width == 1280:
                    page.click(".dc-nav-item:has-text('Redshirts')")
                    page.wait_for_selector(".dc-person", timeout=30_000)
                    page.click(".dc-person button:has-text('Redshirt') >> nth=0")
                    page.wait_for_selector(".dc-person button:has-text('Off redshirt')", timeout=30_000)
                    assert "sitting out" in page.inner_text(".dc-people").lower()
                    page.click(".dc-person button:has-text('Off redshirt')")
                    page.wait_for_function("() => !document.body.innerText.includes('Off Redshirt')", timeout=30_000)
                # the Players box: a tile picks a player and his card follows; the arrows walk the box
                page.click(".dc-nav-item:has-text('Players')")
                page.wait_for_selector(".dc-tile", timeout=30_000)
                tiles = page.locator(".dc-tile")
                assert tiles.count() > 10, "a box of portraits"
                tile2 = tiles.nth(1).get_attribute("data-slug")
                tiles.nth(1).click()
                page.wait_for_function("(slug) => new URLSearchParams(location.search).get('player') === slug", arg=tile2, timeout=30_000)
                page.wait_for_selector(".dc-pc-attrs", timeout=60_000)
                assert page.inner_text(".dc-pc-name").strip() == page.locator(".dc-tile.on").get_attribute("title").split(" · ")[0]
                page.keyboard.press("ArrowRight")
                page.wait_for_function("(slug) => new URLSearchParams(location.search).get('player') !== slug", arg=tile2, timeout=30_000)
                # a player page from the rail: attribute labels do not clip; the bar colors are explained
                page.click(".dc-nav-item:has-text('Overview')")
                page.wait_for_selector(".dc-card", timeout=30_000)
                page.click(".dc-card >> nth=0")
                page.click(".dc-panel-acts .dc-player-link")
                page.wait_for_selector(".player-page", timeout=60_000)
                time.sleep(1.5)
                clipped = not_clipped(page, ".player-page .rating-label")
                assert not clipped, f"{width}px: {clipped[:3]}"
                legend = page.inner_text(".player-page")
                assert "75" in legend and ("red" in legend.lower() or "green" in legend.lower()), "the rating bar colors are explained"
                assert not CLASS_CODE.search(legend), CLASS_CODE.search(legend).group(0)
                page.keyboard.press("Escape")
                # Back to the season; a link straight to the screen opens it on the screen it names
                page.click(".dc-btn-back")
                page.wait_for_selector("#season:visible", timeout=30_000)
                assert "screen=depth" not in page.url and page.is_hidden("#depth-screen")
                page.goto(f"{base}/index.html?id={A}&screen=depth&view=list&unit=defense&role=CB")
                page.wait_for_selector(".dc-table tbody tr", timeout=120_000)
                assert page.inner_text(".dc-role.on").strip() == "CB", "the link opens the screen it names"
                # an old link to the Personnel screen lands on the List view
                page.goto(f"{base}/index.html?id={A}&screen=depth&sub=personnel&role=WR")
                page.wait_for_selector(".dc-table tbody tr", timeout=120_000)
                assert page.inner_text(".dc-role.on").strip() == "WR"
                # on a laptop the screen fits the window: no page scroll
                if width == 1280:
                    page.set_viewport_size({"width": 1280, "height": 720})
                    for unit in ("offense", "defense"):
                        page.goto(f"{base}/index.html?id={A}&screen=depth&unit={unit}")
                        page.wait_for_selector(".dc-card", timeout=120_000)
                        time.sleep(0.8)
                        over = page.evaluate("() => [document.documentElement.scrollHeight - innerHeight, document.querySelector('.dc-rows').classList.contains('fit-scroll')]")
                        assert over[0] <= 0 and not over[1], f"{unit} at 1280x720: the page or the field scrolls {over}"
                    page.set_viewport_size({"width": width, "height": 1000})
            page.set_viewport_size({"width": 1280, "height": 1000})

            # --- A call left open when the week moves on: Finish finds it gone, drops the scene and unlocks the menu
            open_tab(page, base, A, "recruiting", ".go-stages")
            page.click(f".go-row-recruit[data-pid='{second}']")
            time.sleep(0.5)
            assert page.query_selector("#rc-finish"), "the call hung up earlier is still open"
            test_stale_scene_unlocks(page, base, A)
            # a new week's hours: a third recruit's call pitched on something he does not care about: the cue stays ☆ in the pane and in the step
            third = next(x for x in order if x not in (pid, second))
            page.click(f".go-row-recruit[data-pid='{third}']")
            time.sleep(0.6)
            n = draws(page)
            page.click("#rc-recruit")
            page.click(".go-menu .go-menu-item[data-action=call]")
            present_three(page)
            page.wait_for_selector(".go-pane .go-scene .go-scene-line.cue", timeout=30_000)
            settle(page, n)
            row3 = next(x for x in call(base, f"/api/season/{A}/recruiting")["board"] if x["id"] == third)
            cue3 = [t for t in row3["scene"]["cue"]["topics"] if t not in row3["priorities_known"]]
            pri3 = season.load_season(A)["recruiting"]["prospects"][third]["priorities"]
            miss = next(t for t in PITCH if t not in pri3 and t not in row3["scene"]["cue"]["topics"])
            page.click(f".go-pane .go-pitch:has(input[value='{miss}'])")
            n = draws(page)
            page.click(".go-pane button:has-text('Pitch')")
            page.wait_for_selector(".go-pane .go-reaction", timeout=30_000)
            settle(page, n)
            hollow = page.eval_on_selector_all(".go-pane .go-tags .go-tag.cue", "els => els.map(e => [e.textContent, e.title])")
            assert hollow == [[f"☆ {PITCH[t]}", CUE_TITLE] for t in cue3] and hollow, (hollow, cue3)
            page.click("#rc-recruit")
            page.click(".go-menu .go-menu-item[data-action=offer]")
            page.wait_for_selector(".go-pane .go-step select#rc-pitch")
            opts = dict(page.eval_on_selector_all("#rc-pitch option", "o => o.map(x => [x.value, x.textContent])"))
            for t in cue3:
                assert opts[t].startswith(f"☆ {PITCH[t]} · "), opts
            for t in row3["priorities_known"]:
                assert opts[t].startswith(f"★ {PITCH[t]}") and "☆" not in opts[t], opts
            assert GONE not in page.inner_text("body")
            page.click(".go-pane .go-step button.go-step-cancel")
            assert not errors, errors

            # --- Smoothness: every board action patches in place (the pane stays, nothing that holds it is removed, no scroll
            #     jump), says what happened in a toast with the spec's words, and leaves the focus on a control
            wait_week(base, A)      # a new week's hours
            # a board of a dozen more uncommitted prospects (no hours): the list outruns the pane, as a real board does, so the
            # page's height does not follow the pane (a step closing would shrink the page and the browser clamp the scroll)
            on_board = {b["id"] for b in call(base, f"/api/season/{A}/recruiting")["board"]}
            for r in [r for r in call(base, f"/api/season/{A}/prospects?status=open&limit=60")["rows"] if r["id"] not in on_board][:12]:
                call(base, f"/api/season/{A}/board", {"pid": r["id"], "on": True})
            open_tab(page, base, A, "recruiting", ".go-stages")
            vb = call(base, f"/api/season/{A}/recruiting")
            assert vb["hours_left"] >= 50, vb["hours_left"]
            fresh_rows = [b for b in vb["board"] if not b["offered"] and not b["committed"] and not b["signed"] and not b.get("scene")
                          and (b.get("looks") or 0) < 3 and b["id"] not in (pid, second, third)]
            x, y = fresh_rows[0], fresh_rows[1]
            cold = next(b for b in fresh_rows[2:] if b["stage"] == "cold")
            assert page.get_attribute("#toasts", "role") == "status" and page.get_attribute("#toasts", "aria-live") == "polite", "the toast stack is announced"

            def menu(action):
                page.click("#rc-recruit")
                page.wait_for_selector(".go-menu[role=menu]")
                page.click(f".go-menu .go-menu-item[data-action={action}]")

            page.click(f".go-row-recruit[data-pid='{x['id']}']")
            time.sleep(1.2)                       # the first pick's own smooth scroll ends
            page.evaluate("() => window.scrollTo(0, Math.max(window.scrollY, 120))")   # the page is scrolled, so a jump back to 0 would show
            time.sleep(0.3)
            # Message: the step's Send goes busy, the step closes, the row and the pane update in place
            menu("message")
            page.wait_for_selector(".go-pane .go-step select#rc-pitch")
            h = watch(page, ".go-pane", ".go-pane .go-step button.go-step-go")
            n = draws(page)
            page.click(".go-pane .go-step button.go-step-go")
            assert page.evaluate("() => { const b = document.querySelector('.go-pane .go-step-go'); return !b || (b.disabled && b.classList.contains('go-busy')); }"), "Send shows busy while the action is in flight"
            toasted(page, f"Message sent to {x['name']} · 5 hours")
            settle(page, n)
            smooth(page, h, "Message")
            assert not page.query_selector(".go-pane .go-step"), "the step closes once the message is sent"
            assert page.evaluate("() => document.activeElement.id") == "rc-recruit", "focus goes to the Recruit button once the step closed"
            # Offer: the NIL cell and the Offered tag change and pulse
            menu("offer")
            page.wait_for_selector(".go-pane .go-step input#rc-nil")
            nil = int(page.input_value("#rc-nil"))
            h = watch(page, ".go-pane", ".go-pane .go-step button.go-step-go")
            n = draws(page)
            page.click(".go-pane .go-step button.go-step-go")
            toasted(page, f"Offer sent to {x['name']} · {nil} NIL")
            page.wait_for_selector(".go-pane .go-strip .go-changed", timeout=10_000)
            settle(page, n)
            smooth(page, h, "Offer")
            # the tag carries the points when there are any (an offer to a recruit with no ask known starts at 0: plain "Offered")
            page.wait_for_function("(t) => [...document.querySelectorAll('.go-pane .go-tags .go-tag')].some(e => e.textContent.trim() === t)", arg=f"Offered · {nil} NIL" if nil else "Offered", timeout=10_000)
            assert f"{nil} NIL" in page.inner_text(".go-pane .go-strip") and "your " not in page.inner_text(".go-pane .go-strip .go-stat:nth-child(3)")
            # Raise NIL
            menu("raise_nil")
            page.wait_for_selector(".go-pane .go-step input#rc-nil")
            nil2 = int(page.input_value("#rc-nil"))
            assert nil2 > nil
            h = watch(page, ".go-pane", ".go-pane .go-step button.go-step-go")
            n = draws(page)
            page.click(".go-pane .go-step button.go-step-go")
            toasted(page, f"Offer raised to {nil2} NIL")
            settle(page, n)
            smooth(page, h, "Raise NIL")
            assert f"{nil2} NIL" in page.inner_text(".go-pane .go-strip")
            # Scout: from the menu, the Recruit button is the busy control and gets the focus back
            looks = min(3, (x.get("looks") or 0) + 1)          # looks in trip units: a Send adds one (an area week added halves)
            h = watch(page, ".go-pane", "#rc-recruit")
            n = draws(page)
            menu("scout")
            toasted(page, f"Scouted {x['name']} · {str(int(looks)) if looks == int(looks) else f'{looks:.1f}'} of 3 looks")
            settle(page, n)
            smooth(page, h, "Scout")
            assert page.evaluate("() => document.activeElement.id") == "rc-recruit"
            assert f"{str(int(looks)) if looks == int(looks) else f'{looks:.1f}'} of 3 looks" in page.inner_text(".go-pane .go-strip")
            # Call: the scene opens inside the same pane; the pitch's toast sits clear of his reply
            h = watch(page, ".go-pane", "#rc-recruit")
            n = draws(page)
            menu("call")
            toasted(page, f"Called {x['name']} · 15 hours")
            present_three(page)
            page.wait_for_selector(".go-pane .go-scene .go-scene-line.cue", timeout=30_000)
            settle(page, n)
            smooth(page, h, "Call")
            topic = next(bb for bb in call(base, f"/api/season/{A}/recruiting")["board"] if bb["id"] == x["id"])["scene"]["cue"]["topics"][0]
            page.click(f".go-pane .go-pitch:has(input[value='{topic}'])")
            h = watch(page, ".go-pane", ".go-pane button:has-text('Pitch')")
            n = draws(page)
            page.click(".go-pane button:has-text('Pitch')")
            page.wait_for_selector(".go-pane .go-reaction", timeout=30_000)
            kind = page.get_attribute(".go-pane .go-reaction", "data-kind")
            toasted(page, f"Pitch: {PITCH[topic]} · {REACTION[kind]}")
            assert no_overlap(page, "#toasts", ".go-pane .go-reaction"), "a pitch's toast never covers his reply"
            smooth(page, h, "Pitch")
            h = watch(page, ".go-pane")      # a fresh watch: smooth() disconnected the first observer
            settle(page, n)          # his reaction stays a moment, then the board catches up in place
            smooth(page, h, "Pitch, after the re-fetch")
            assert page.query_selector(".go-pane .go-scene .go-reaction"), "the finished conversation stays on screen"
            # Pull offer: confirmed, the offer goes; the tag leaves and the cell changes in place
            page.remove_listener("dialog", dismiss)
            page.once("dialog", lambda d: d.accept())
            h = watch(page, ".go-pane", "#rc-recruit")
            n = draws(page)
            menu("pull_offer")
            toasted(page, f"Offer to {x['name']} pulled")
            settle(page, n)
            page.on("dialog", dismiss)
            smooth(page, h, "Pull offer")
            assert "Offered" not in page.inner_text(".go-pane .go-tags") if page.query_selector(".go-pane .go-tags") else True
            assert not next(bb for bb in call(base, f"/api/season/{A}/recruiting")["board"] if bb["id"] == x["id"])["offered"]
            # Off the board: the row leaves, the pane switches to the next recruit with a cross-fade (120 ms, none under reduced motion)
            h = watch(page, ".go-pane", "#rc-recruit")
            n = draws(page)
            menu("off_board")
            toasted(page, f"{x['name']} is off your board")
            settle(page, n)
            smooth(page, h, "Off the board", same=False)
            assert not page.query_selector(f".go-row-recruit[data-pid='{x['id']}']"), "his row left the list"
            first_now = page.get_attribute(".go-row-recruit >> nth=0", "data-pid")
            assert page.eval_on_selector_all(".go-row-recruit[aria-pressed=true]", "els => els.map(e => e.dataset.pid)") == [first_now], "the pane moved to the first row"
            assert page.evaluate("() => getComputedStyle(document.querySelector('.go-pane')).transitionDuration") == "0.12s"
            assert page.evaluate("() => document.activeElement.tagName") != "BODY"
            # the toast stack: at most three, newest on top
            page.evaluate("() => { for (const t of ['one', 'two', 'three', 'four']) window.CFP.ui.toast(t); }")
            time.sleep(0.4)
            stack = page.eval_on_selector_all("#toasts .toast-item:not(.go-leaving)", "els => els.map(e => e.textContent.trim())")
            assert len(stack) == 3 and stack[0] == "four" and stack[-1] == "two", stack
            # Review Focus 1: two quick actions: a Message whose re-fetch is slow, then a Call before it lands; the stale
            # re-fetch is dropped and the board shows both
            page.click(f".go-row-recruit[data-pid='{y['id']}']")
            time.sleep(0.6)
            menu("message")
            page.wait_for_selector(".go-pane .go-step select#rc-pitch")
            hours = call(base, f"/api/season/{A}/recruiting")["hours_left"]
            page.evaluate("""() => { const g = window.CFP.game, orig = g.fetch; let held = 0; window.__restoreFetch = () => { g.fetch = orig; };
                g.fetch = async (p, o) => { const r = await orig(p, o); if (/\\/recruiting$/.test(String(p)) && !(o && o.method) && held++ === 0) await new Promise((res) => setTimeout(res, 2500)); return r; }; }""")
            n = draws(page)
            page.click(".go-pane .go-step button.go-step-go")
            toasted(page, f"Message sent to {y['name']} · 5 hours")
            menu("call")
            toasted(page, f"Called {y['name']} · 15 hours")
            present_three(page)
            page.wait_for_selector(".go-pane .go-scene .go-scene-line.cue", timeout=30_000)
            settle(page, n)
            time.sleep(3)
            page.evaluate("() => window.__restoreFetch()")
            assert draws(page) == n + 1, "the superseded re-fetch is dropped, the later one patches once"
            assert f"{hours - 20} / " in page.inner_text(".go-meters"), page.inner_text(".go-meters")
            assert page.query_selector(".go-pane .go-scene"), "the call's scene stays on screen"
            page.click(".go-pane .go-scene button:has-text('Hang Up')")
            time.sleep(0.3)
            # Review Focus 2: an action moves him out of the open tab: the row leaves, the counts update, the pane stays on him
            page.click(".go-stages button[data-stage=cold]")
            time.sleep(0.5)
            page.click(f".go-row-recruit[data-pid='{cold['id']}']")
            time.sleep(0.6)
            before = dict(page.evaluate("() => [...document.querySelectorAll('.go-stages button[data-stage]')].map(b => [b.dataset.stage, +b.querySelector('b').textContent])"))
            menu("message")
            page.wait_for_selector(".go-pane .go-step select#rc-pitch")
            h = watch(page, ".go-pane", ".go-pane .go-step button.go-step-go")
            n = draws(page)
            page.click(".go-pane .go-step button.go-step-go")
            toasted(page, f"Message sent to {cold['name']} · 5 hours")
            settle(page, n)
            smooth(page, h, "Message from the Cold tab")
            assert not page.query_selector(f".go-row-recruit[data-pid='{cold['id']}']"), "the row left the Cold tab"
            assert cold["name"] in page.inner_text(".go-pane .go-pane-head"), "the pane stays on him"
            assert page.eval_on_selector_all(".go-row-recruit[aria-pressed=true]", "els => els.length") == 0, "no other row is picked"
            after = dict(page.evaluate("() => [...document.querySelectorAll('.go-stages button[data-stage]')].map(b => [b.dataset.stage, +b.querySelector('b').textContent])"))
            assert after["cold"] == before["cold"] - 1 and after["contact"] == before["contact"] + 1, (before, after)
            assert page.get_attribute(".go-stages button[data-stage=cold]", "aria-pressed") == "true"
            page.click(".go-stages button[data-stage=all]")
            time.sleep(0.4)
            # reduced motion: no pulse, no fade, no cross-fade
            page.emulate_media(reduced_motion="reduce")
            motion = page.evaluate("""() => { const p = document.querySelector('.go-pane'), w = p.querySelector('.go-chip'); w.classList.add('go-changed');
                const r = [getComputedStyle(p).transitionDuration, getComputedStyle(w).animationDuration, getComputedStyle(w).transitionDuration]; w.classList.remove('go-changed'); return r; }""")
            assert motion == ["0s", "0s", "0s"], motion
            page.emulate_media(reduced_motion="no-preference")
            motion = page.evaluate("""() => { const w = document.querySelector('.go-pane .go-chip'); w.classList.add('go-changed');
                const r = getComputedStyle(w).animationDuration; w.classList.remove('go-changed'); return r; }""")
            assert motion == "0.6s", motion
            assert not errors, errors

            # --- Scouting: the scouts, the queue (Send patches in place), the reports and the flags
            test_scouting_tab(page, base, A)

            # --- Box score of an FCS game: the stand-in's players are plain text (it has no player
            # pages), the FBS side's names still open the player page
            fict = {slug for slug, t in season.load_teams().items() if t["fictional"]}
            sched = call(base, f"/api/season/{A}/schedule/smu")["schedule"]
            fcs_game = next(g for g in sched if g.get("opponent") in fict)
            call(base, f"/api/season/{A}/advance", {"to": fcs_game["week"]})
            for _ in range(1200):
                if call(base, f"/api/season/{A}/status")["status"] != "running":
                    break
                time.sleep(0.5)
            box = call(base, f"/api/season/{A}/game/{fcs_game['event_id']}")
            fside, bside = ("home", "away") if box["home_slug"] in fict else ("away", "home")
            open_tab(page, base, A, "schedule", ".schedule-pick")
            page.click(f"#tab-schedule tr.clickable:has-text('{fcs_game['opponent_name']}')")
            page.wait_for_selector(f"#sbox-{bside} [data-player]", state="attached", timeout=60_000)
            stand_in = page.evaluate(f"() => [document.querySelectorAll('#sbox-{fside} td.name, #sbox-{fside} [data-player], #sbox-{fside} .plink').length, document.querySelectorAll('#sbox-{fside} [data-player], #sbox-{fside} .plink').length, document.querySelector('#sbox-{fside}').textContent]")
            names = [p["name"] for p in box[fside]["players"]]
            assert any(n in stand_in[2] for n in names), "the stand-in's players are in the box score"
            assert stand_in[1] == 0, f"{stand_in[1]} FCS stand-in player names link to a player page"
            assert page.eval_on_selector_all(f"#sbox-{bside} [data-player]", "els => els.length") > 0, "the FBS side's names still link"
            page.keyboard.press("Escape")
            assert not errors, errors

            check_header(page, base, A)
            check_position_change(page, base, A)
            check_topbar_hide(page, base, A)

            # --- Offseason, every stage: no number out of 100, no run-together class codes
            page.goto(f"{base}/index.html?id={B}")
            page.wait_for_selector("#tab-offseason .off-steps", timeout=120_000)
            check_nil_review(page, base, B)
            off = page.inner_text("#tab-offseason")
            assert not OUT_OF_100.search(off), OUT_OF_100.search(off).group(0)
            assert not CLASS_CODE.search(off), CLASS_CODE.search(off).group(0)
            # "Sim to next season" asks first: dismissed, nothing moves
            n_dialogs = len(dialogs)
            page.click("#tab-offseason button:has-text('Sim to Next Season')")
            time.sleep(1)
            assert len(dialogs) == n_dialogs + 1, "skipping the whole offseason asks first"
            assert call(base, f"/api/season/{B}/offseason")["stage"] == "departures"
            call(base, f"/api/season/{B}/offseason/advance", {})
            v = call(base, f"/api/season/{B}/offseason")
            if v["stage"] == "retention":
                page.goto(f"{base}/index.html?id={B}")
                page.wait_for_selector("text=WANT OUT", timeout=120_000)
                time.sleep(0.8)
                clipped = not_clipped(page, ".off-keep-acts button b")
                assert not clipped, clipped[:3]
                keep = page.inner_text("#tab-offseason")
                assert not CLASS_CODE.search(keep), CLASS_CODE.search(keep).group(0)
                # letting a player go asks first
                n_dialogs = len(dialogs)
                page.click(".off-keep button.go-act:has-text('Let Him Go') >> nth=0")
                time.sleep(0.8)
                assert len(dialogs) == n_dialogs + 1, "letting a player go asks first"
                assert "letting go" not in page.inner_text(".off-keep .go-pcard >> nth=0")
                call(base, f"/api/season/{B}/offseason/advance", {})
            # the portal board: a transfer has no star row
            page.goto(f"{base}/index.html?id={B}")
            page.wait_for_selector("text=WEEK 1 OF 4", timeout=120_000)
            time.sleep(0.8)
            hollow = page.evaluate("() => [...document.querySelectorAll('.go-row-recruit .go-stars, .go-pane .go-stars')].filter(e => /^☆+$/.test(e.textContent.trim())).length")
            assert hollow == 0, f"{hollow} transfer rows show an empty star row"
            test_portal_nil_title(page, base, B)
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
            page.goto(f"{base}/index.html?id={B}")
            page.wait_for_selector("text=COACHES FOR HIRE", timeout=120_000)
            time.sleep(0.8)
            staff = page.inner_text("#tab-offseason")
            assert not OUT_OF_100.search(staff), OUT_OF_100.search(staff).group(0)
            dup = page.evaluate("() => [...document.querySelectorAll('.off-table tbody tr')].filter(r => r.cells[3].textContent.trim() === r.cells[4].textContent.trim()).length")
            assert dup == 0, f"{dup} coaches repeat why they are available as their last job"
            lg = page.query_selector("button.go-act:has-text('Let Him Go')")
            if lg:
                page.remove_listener("dialog", dismiss)
                page.once("dialog", lambda d: d.accept())
                lg.click()
                page.wait_for_selector(".off-cand", timeout=60_000)
                hire = page.get_attribute(".off-cand > :last-child", "class") or ""
                assert "go-btn" in hire, f"the hire control reads as a button, not a tag ({hire})"
            check_staff_contracts(page, base, B)
            check_staff_developed(page, base, B)
            test_pester_tags(page, base)
            test_recruit_question(page)
            test_look_units_pane(page, base, A)
            test_staff_likes_tags(page, base)
            test_grade_hover(page, base, A)
            test_flip_words(page, base)
            test_conversation(page, base)
            test_sim_bar(page, base)
            browser.close()
        assert not errors, errors
        print("ux sweep ok: office, prospects, board (tabs, list, pane, menu, step, scene, phone, every action patching in place with its toast), scouting, schedule, depth, player page, an FCS box score and every offseason stage at 1280 and 400")
    finally:
        for sid in (fresh["id"], done["id"]):
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
        server.terminate()
