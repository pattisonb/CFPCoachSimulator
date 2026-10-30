"""The UX sweep's regressions, in a browser at desktop and phone width: no stray "null", no
number out of 100, depth-chart controls big enough to tap and never faint, labels that do not
clip, buttons that say what they do, class codes that read, tooltips reachable by tap, and the
confirms a one-tap skip needs. Needs Playwright with a Chromium; skipped without one."""
import os
import re
import subprocess
import sys
import time
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
    """The board's redraw counter (web/recruiting.js stamps it on every draw)."""
    return page.evaluate("() => +(document.querySelector('.rc-head').parentElement.dataset.draw || 0)")


def settle(page, before: int) -> None:
    """The board re-fetches after an action lands; wait for that redraw before the next click."""
    page.wait_for_function("(n) => +(document.querySelector('.rc-head').parentElement.dataset.draw || 0) > n", arg=before, timeout=30_000)
    time.sleep(0.3)


def test_stale_scene_unlocks(page, base, sid) -> None:
    """A call left open when the week moves on: Finish re-reads the board, finds the call gone, drops the
    scene and the Recruit menu works again."""
    call(base, f"/api/season/{sid}/advance", {})
    for _ in range(1200):
        if call(base, f"/api/season/{sid}/status")["status"] != "running":
            break
        time.sleep(0.5)
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
LADDER = {"Yours": 0, "Favorite": 1, ("Not offered", "warn"): 2, "In it": 3, "Long shot": 4, ("Not offered", "muted"): 5, "Lost": 6}


def ladder_of(sd: dict) -> int:
    return LADDER[(sd["word"], sd["tone"])] if sd["word"] == "Not offered" else LADDER[sd["word"]]


def assert_chance_order(page, board: list, me: str) -> None:
    """The rows on screen, sorted by your chance, climb the ladder without a step back; within a rung the fuller bar first."""
    shown = page.eval_on_selector_all(".go-row-recruit", "els => els.map(e => e.dataset.pid)")
    by = {b["id"]: b for b in board}
    sds = page.evaluate("([rows, me]) => rows.map(b => window.CFP.recruiting.standingOf(b, me))", [[by[x] for x in shown], me])
    keys = [(ladder_of(sd), -(sd.get("fill") or 0)) for sd in sds]
    assert keys == sorted(keys), f"the board sorted by your chance breaks the ladder: {list(zip(shown, [sd['word'] for sd in sds]))}"


PITCH = {"proximity": "Close to home", "playing_time": "Playing time", "prestige": "Program prestige", "winning": "Winning now",
         "nil": "NIL", "coach": "The head coach", "academics": "Academics"}
REACTION = {"hit": "He lit up", "polite": "Polite", "quiet": "He went quiet"}
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
        assert t0 - tabs["scrolled"] < tabs["visTop"] - 4, f"the check scrolls the strip's place out of view at {width}: {t0}, {tabs}"
        assert tabs["top"] <= tabs["visTop"] + 4, f"the sub-tab strip pins to the top of the pane's scroll box at {width}: {tabs}"
        shot(page, f"pane-profile-scrolled-{width}-dark")
        if width <= 700:
            page.click(".go-pane .go-pane-back")
    page.set_viewport_size({"width": 1280, "height": 1000})


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
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
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
            assert words and set(words) <= {"Favorite", "In it", "Long shot", "Yours", "Lost", "Not offered"}, words
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
            assert ladder[1] == {"lost": "Lost", "trail": "Long shot", "lead": "Not offered", "cold": "Not offered", "init": "In it", "fav2": "Favorite",
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
            STAGE_WORD = {"cold": "Cold", "contact": "In touch", "top": "Top 8", "visited": "Visited"}
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
            assert lines == ["Week 6 · Committed to Georgia", "Week 5 · Offer · 120 NIL", "Week 4 · Call · Program prestige · He lit up",
                             "Week 3 · Message · Playing time", "Week 2 · Offered by Georgia"], lines
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
            toast = page.inner_text("#toast")
            assert toast.startswith(("He lit up:", "He was polite and moved on", "He went quiet:")), toast
            settle(page, n)   # the reaction stays four seconds, then the board re-fetches
            assert not page.query_selector(".go-pane .go-reaction"), "the board re-renders after his reaction"
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
            page.wait_for_selector(".go-pane .go-scene .go-scene-line.cue", timeout=30_000)
            settle(page, n)
            page.click("#rc-recruit")
            page.wait_for_selector(".go-menu")
            assert page.eval_on_selector_all(".go-menu .go-menu-item", "els => els.every(e => e.getAttribute('aria-disabled') === 'true' && e.querySelector('.go-menu-why').textContent === 'Finish your call first')")
            page.keyboard.press("Escape")
            page.click(".go-pane .go-scene button:has-text('Hang up')")
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
            page.click(".go-map button:has-text('List the states')")
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
            page.click(".go-map button:has-text('List the states')")
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
            page.click(".go-pane .go-scene button:has-text('Hang up')")
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
            assert words[mine_pid] == "Yours" and words[lost_pid] == "Lost" and words[hard_pid] == "Lost" and words[hard_noffer_pid] == "Lost" and words[verbal_pid] in ("In it", "Long shot"), words
            page.click(f".go-row-recruit[data-pid='{lost_pid}']")
            time.sleep(0.5)
            assert page.text_content(".go-pane .go-chip").startswith("Signed · ") and not page.query_selector("#rc-recruit"), "a prospect signed elsewhere has no Recruit menu"
            page.click(f".go-row-recruit[data-pid='{mine_pid}']")
            time.sleep(0.5)
            assert page.text_content(".go-pane .go-chip").strip() == "Signed with you" and not page.query_selector("#rc-recruit"), "a prospect who signed with you has no Recruit menu"
            # a verbal commit elsewhere can still be offered to try for a flip: the chip says so, the Overview talks of the flip, Offer is live
            page.click(f".go-row-recruit[data-pid='{verbal_pid}']")
            time.sleep(0.5)
            assert page.text_content(".go-pane .go-chip").startswith("Verbal commit · ")
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
            assert page.text_content(".go-pane .go-chip").startswith("Hard commit · ")
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
            assert page.text_content(".go-pane .go-chip").startswith("Hard commit · ")
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
            for sel, txt in ((".go-class-list .go-badge.gem-held", "Gem: the read held"), (".go-class-list .go-badge.bust-held", "Bust risk: the read held"),
                             (".go-class-list .go-badge.gem-missed", "The read was off")):
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
            # three scouting trips at the best unscouted five-star, then the list agrees with the API either way
            pick = min((r for r in unscouted if r.get("can_scout")), key=lambda r: r["national_rank"], default=None)
            if pick and call(base, f"/api/season/{A}/recruiting")["hours_left"] >= 15:
                for _ in range(3):
                    call(base, f"/api/season/{A}/recruit", {"pid": pick["id"], "action": "scout"})
                after = next(r for r in call(base, f"/api/season/{A}/prospects?stars=5&limit=200&q={urllib.parse.quote(pick['name'])}")["rows"] if r["id"] == pick["id"])
                assert after["looks"] >= 3
                page.fill("input[aria-label='Search by name']", pick["name"])
                time.sleep(1.5)
                badge = page.query_selector(".go-list-row .go-badge.generational")
                assert bool(badge) == bool(after.get("generational")), "after three looks the list shows the tag exactly when the API does"
                if badge:
                    assert badge.text_content().strip() == "Generational"

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
                # a player page: attribute labels do not clip; the bar colors are explained
                keys = page.evaluate("() => [...document.querySelectorAll('[data-player]')].slice(0, 3).map(e => e.dataset.player)")
                page.click(f"[data-player='{keys[1]}']")
                page.wait_for_selector(".player-page", timeout=60_000)
                time.sleep(1.5)
                clipped = not_clipped(page, ".player-page .rating-label")
                assert not clipped, f"{width}px: {clipped[:3]}"
                legend = page.inner_text(".player-page")
                assert "75" in legend and ("red" in legend.lower() or "green" in legend.lower()), "the rating bar colors are explained"
                assert not CLASS_CODE.search(legend), CLASS_CODE.search(legend).group(0)
                page.keyboard.press("Escape")
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

            # --- Offseason, every stage: no number out of 100, no run-together class codes
            page.goto(f"{base}/index.html?id={B}")
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
                page.goto(f"{base}/index.html?id={B}")
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
            page.goto(f"{base}/index.html?id={B}")
            page.wait_for_selector("text=WEEK 1 OF 4", timeout=120_000)
            time.sleep(0.8)
            hollow = page.evaluate("() => [...document.querySelectorAll('.go-row-recruit .go-stars, .go-pane .go-stars')].filter(e => /^☆+$/.test(e.textContent.trim())).length")
            assert hollow == 0, f"{hollow} transfer rows show an empty star row"
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
            lg = page.query_selector("button.go-act:has-text('Let him go')")
            if lg:
                page.remove_listener("dialog", dismiss)
                page.once("dialog", lambda d: d.accept())
                lg.click()
                page.wait_for_selector(".off-cand", timeout=60_000)
                hire = page.get_attribute(".off-cand > :last-child", "class") or ""
                assert "go-btn" in hire, f"the hire control reads as a button, not a tag ({hire})"
            browser.close()
        assert not errors, errors
        print("ux sweep ok: office, prospects, board (tabs, list, pane, menu, step, scene, phone), staff, schedule, depth, player page and every offseason stage at 1280 and 400")
    finally:
        for sid in (fresh["id"], done["id"]):
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
        server.terminate()
