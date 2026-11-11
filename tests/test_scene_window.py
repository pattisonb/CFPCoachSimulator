"""A call or in-home visit plays in its own window over the recruiting board (web/recruiting.js openSceneWindow):
the dialog opens with the conversation, you play it through there, Done closes it for good (nothing of it stays in
the pane, History keeps one line, a refresh does not bring it back); closing it before the pitch keeps the call
open behind Finish the Call, and a refresh reopens that unfinished window from the address. Opening it and switching
recruits start no pulse or fade. At 400 px the window fills the screen and Done stands 44 px tall. Needs Playwright
with a Chromium; skipped without one. SCENE_SHOTS=<folder> saves the window mid-conversation and after his reaction."""
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

from test_career_e2e import call, free_port, launch, tab_click   # noqa: E402

WIN = ".modal.modal-scene:not([hidden])"
SHOTS = os.environ.get("SCENE_SHOTS")

# a pulse or fade started from now on inside `scope` (a selector), outside the toasts; `kinds`: the classes counted
QUIET_WATCH = """([scope, kinds]) => { const q = window.__quiet = { n: 0, what: [] };
  const has = (cls, c) => (' ' + (cls || '') + ' ').includes(' ' + c + ' ');
  q.obs = new MutationObserver((recs) => { for (const r of recs) for (const c of kinds)
    if (r.target.classList && r.target.classList.contains(c) && !has(r.oldValue, c) && !r.target.closest('#toasts') && r.target.closest(scope))
      { q.n++; if (q.what.length < 6) q.what.push(r.target.className); } });
  q.obs.observe(document.documentElement, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] }); }"""
QUIET_READ = "() => { window.__quiet.obs.disconnect(); return [window.__quiet.n, window.__quiet.what]; }"


def wait_server(base: str) -> None:
    for _ in range(120):
        try:
            urllib.request.urlopen(base + "/api/teams", timeout=2)
            return
        except OSError:
            time.sleep(0.5)


def make_career():
    """A career at week two with hours to spend and five fresh prospects on the board: three for the
    call, and a Package Deal pair (the fourth's mate is the fifth, not offered) for the visit."""
    from coach_career import recruiting
    from sim import season
    me = "smu"
    st = season.new_season(me, "full", seed=23, career=True)
    season.advance_to(st, 2)
    rc = st["recruiting"]
    rc["hours"][me] = 200
    pids = [q for q in recruiting.prospect_list(st) if not rc["prospects"][q].get("hidden") and me not in rc["contacts"].get(q, {})
            and not rc["status"][q]["committed"] and not recruiting.would_pester(st, me, q)][:5]
    rc["board"] = list(pids)
    for a, b, lead in ((pids[3], pids[4], True), (pids[4], pids[3], False)):
        rc["prospects"][a]["persona"] = {"personality": "cocky", "decider": "mom" if lead else "self", "decider_topic": "proximity" if lead else None,
                                         "story": "package", "story_data": {"mate": b, "lead": lead}, "commit_style": "hat"}
    season.save_season(st)
    return st["id"], pids, {q: rc["prospects"][q]["name"] for q in pids}


def modal_tokens(page) -> list:
    return urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query).get("modal", [])


def open_board(page, base, sid) -> None:
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#season:visible")
    tab_click(page, "recruiting")   # through More ▾ on a phone
    page.wait_for_selector(".go-row-recruit", timeout=120_000)
    time.sleep(0.8)


def pick_row(page, pid) -> None:
    page.click(f".go-row-recruit[data-pid='{pid}']")
    page.wait_for_selector(f".go-pane #rc-recruit")
    time.sleep(0.5)


def start_call(page) -> None:
    page.click(".go-pane #rc-recruit")
    page.wait_for_selector(".go-menu[role=menu]")
    page.click(".go-menu .go-menu-item[data-action=call]")
    page.wait_for_selector(f"{WIN} .go-scene .go-opening .go-opening-pick", timeout=30_000)
    time.sleep(0.4)


def start_visit(page) -> None:
    page.click(".go-pane #rc-recruit")
    page.wait_for_selector(".go-menu[role=menu]")
    page.click(".go-menu .go-menu-item[data-action=hc_visit]")
    page.wait_for_selector(f"{WIN} .go-scene .go-opening .go-opening-pick", timeout=30_000)
    time.sleep(0.4)


def present_three(page) -> None:
    page.eval_on_selector_all(f"{WIN} .go-present-chip", "els => els.slice(0, 3).forEach((e) => e.click())")
    page.click(f"{WIN} .go-present")
    page.wait_for_selector(f"{WIN} .go-scene-line.cue", timeout=30_000)
    page.wait_for_selector(f"{WIN} .go-opening", state="detached", timeout=10_000)
    time.sleep(0.4)


def answer_if_asked(page) -> None:
    if page.query_selector(f"{WIN} .go-answer"):
        page.click(f"{WIN} .go-answer[data-answer=straight]")
        page.wait_for_selector(f"{WIN} .go-question-reply", timeout=30_000)
        time.sleep(0.3)


def pitch(page) -> dict:
    answer_if_asked(page)
    # a recruit who gave nothing away on the call leaves no lead picked: pick one, as the player must
    if not page.eval_on_selector(f"{WIN} .go-lead-pick", "e => e.dataset.value"):
        page.click(f"{WIN} .go-lead-pick")
        page.click(f"{WIN} .go-lead-menu .go-lead-chip >> nth=0")
    page.click(f"{WIN} .go-scene-acts button:has-text('Pitch')")
    page.wait_for_selector(f"{WIN} .go-convo .go-turn.go-reaction", timeout=30_000)
    page.wait_for_selector(f"{WIN} .go-scene-close", timeout=10_000)
    time.sleep(0.6)
    return {"kind": page.get_attribute(f"{WIN} .go-reaction", "data-kind"), "text": page.inner_text(f"{WIN} .go-reaction").strip()}


def shot(page, name: str) -> None:
    if SHOTS:
        Path(SHOTS).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(Path(SHOTS) / f"chat-window-{name}.png"), full_page=False)


def no_scene_on_page(page, what: str) -> None:
    assert not page.query_selector(".go-scene"), f"{what}: a conversation is still on the page"
    assert not page.query_selector(".go-reaction"), f"{what}: his reaction is still on the page"
    assert not page.query_selector(WIN), f"{what}: the window is still open"


def desktop(browser, base, sid, pids, names, errs) -> None:
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2, color_scheme="dark")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    pid, other = pids[0], pids[1]
    open_board(page, base, sid)
    pick_row(page, pid)
    # switching recruits starts no pulse or fade in the pane; opening the window none in the window (its turns come in
    # as they are) and no fade in the pane (the call's own result may pulse a cell behind it, as any action does)
    page.evaluate(QUIET_WATCH, [".go-pane, .modal", ["go-changed", "go-fade-in"]])
    pick_row(page, other)
    pick_row(page, pid)
    loud, what = page.evaluate(QUIET_READ)
    assert loud == 0, f"switching recruits flashed or faded {loud} time(s): {what}"
    page.evaluate(QUIET_WATCH, [".modal", ["go-changed", "go-fade-in"]])
    start_call(page)
    loud, what = page.evaluate(QUIET_READ)
    assert loud == 0, f"opening the window flashed or faded {loud} time(s) in it: {what}"
    # the window: a modal dialog over the board, its title the call and his name; the pane plays none of it
    dlg = page.query_selector(f"{WIN} .modal-panel")
    assert dlg.get_attribute("role") == "dialog" and dlg.get_attribute("aria-modal") == "true"
    assert page.inner_text(f"{WIN} .modal-title").strip() == f"Call · {names[pid]}"
    assert not page.query_selector(".go-pane .go-scene"), "the pane plays none of the conversation"
    assert page.evaluate("() => !!document.activeElement.closest('.modal-scene')"), "the focus is in the window"
    assert f"scene:{pid}" in modal_tokens(page), page.url
    assert not page.query_selector(".go-pane #rc-finish"), "Finish stays out of the head while the window is open"
    # Tab stays inside the window
    for _ in range(12):
        page.keyboard.press("Tab")
        assert page.evaluate("() => !!document.activeElement.closest('.modal-scene')"), "Tab left the window"
    present_three(page)
    # closing before the pitch keeps the call open: the close button leaves Finish the Call in the pane
    page.click(f"{WIN} .modal-close")
    page.wait_for_selector(WIN, state="hidden", timeout=10_000)
    page.wait_for_selector(".go-pane #rc-finish", timeout=10_000)
    assert page.inner_text(".go-pane #rc-finish").strip() == "Finish the Call"
    assert page.evaluate("() => document.activeElement.id") == "rc-finish", "Finish takes the focus"
    assert not page.query_selector(".go-scene"), "a closed window leaves nothing of the call on the page"
    assert not any(t.startswith("scene:") for t in modal_tokens(page)), page.url
    # Finish brings the window back where you left it; a refresh reopens it from the address
    page.click(".go-pane #rc-finish")
    page.wait_for_selector(f"{WIN} .go-scene-line.cue", timeout=30_000)
    assert f"scene:{pid}" in modal_tokens(page), page.url
    page.reload()
    page.wait_for_selector(f"{WIN} .go-scene-line.cue", timeout=120_000)
    time.sleep(0.8)
    assert page.inner_text(f"{WIN} .modal-title").strip() == f"Call · {names[pid]}"
    answer_if_asked(page)
    shot(page, "1280-mid")
    # Promise Him the Job: asked or not, on the call; his reply joins the conversation and the button is gone
    page.wait_for_selector(f"{WIN} .go-promise-job", timeout=10_000)
    assert page.inner_text(f"{WIN} .go-promise-job").strip() == "Promise Him the Job"
    n_turns = page.eval_on_selector_all(f"{WIN} .go-convo .go-turn", "els => els.length")
    page.click(f"{WIN} .go-promise-job")
    page.wait_for_selector(f"{WIN} .go-promise-job", state="detached", timeout=15_000)
    turns = page.eval_on_selector_all(f"{WIN} .go-convo .go-turn", "els => els.map(e => e.textContent)")
    assert len(turns) == n_turns + 2 and "The job's yours" in turns[-2], turns[-3:]
    assert not any(w in " ".join(turns[-2:]) for w in ("null", "undefined", "NaN")), turns[-2:]
    re_ = pitch(page)
    assert re_["kind"] in ("hit", "polite", "quiet", "tired", "guarded"), re_
    # after his reaction: Done, the note, no Pitch or Hang Up; the address no longer names the window
    assert page.inner_text(f"{WIN} .go-scene-close").strip() == "Done"
    assert "counts at the week step" in page.inner_text(f"{WIN} .go-scene-acts")
    assert not page.query_selector(f"{WIN} .go-scene-acts button:has-text('Pitch')") and "Hang Up" not in page.inner_text(f"{WIN} .go-scene")
    assert page.evaluate("() => document.activeElement.classList.contains('go-scene-close')"), "Done takes the focus"
    assert not any(t.startswith("scene:") for t in modal_tokens(page)), page.url
    shot(page, "1280-after")
    page.click(f"{WIN} .go-scene-close")
    page.wait_for_selector(WIN, state="hidden", timeout=10_000)
    time.sleep(0.6)
    no_scene_on_page(page, "after Done")
    assert not page.query_selector(".go-pane #rc-finish"), "a finished call leaves no Finish"
    assert page.evaluate("() => document.activeElement.id") == "rc-recruit", "the Recruit button takes the focus"
    # History keeps one line for the call; none of the conversation
    page.click(".go-pane .go-subtabs button[data-sub=history]")
    page.wait_for_selector(".go-pane .go-history-rows", timeout=10_000)
    time.sleep(0.4)
    lines = page.eval_on_selector_all(".go-pane .go-history-rows li", "els => els.map(e => e.dataset.line)")
    calls = [t for t in lines if re.match(r"^Week \d+ · Call · ", t)]
    assert len(calls) == 1, lines
    assert not any(re_["text"] in t for t in lines), "History keeps a line, not his words"
    page.click(".go-pane .go-subtabs button[data-sub=overview]")
    # another recruit and back: no conversation; a refresh does not bring it back
    pick_row(page, other)
    pick_row(page, pid)
    no_scene_on_page(page, "back on him")
    page.reload()
    page.wait_for_selector(".go-pane #rc-recruit", timeout=120_000)
    time.sleep(1.5)
    no_scene_on_page(page, "after a refresh")
    ctx.close()


def package_visit(browser, base, sid, pids, names, errs) -> None:
    """A Package Deal's in-home visit: his mother brings his mate up, and after your opening the window asks about
    him with the three buttons in the package's words (his mate not offered): Tell Him Straight, Promise Him an Offer,
    Sidestep It, each over the line naming his mate; the promise's reply comes back in place and History words it."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2, color_scheme="dark")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    pid, mate = pids[3], names[pids[4]]
    open_board(page, base, sid)
    pick_row(page, pid)
    start_visit(page)
    assert page.inner_text(f"{WIN} .modal-title").strip() == f"In-Home Visit · {names[pid]}"
    convo = page.inner_text(f"{WIN} .go-convo")
    assert mate in convo or mate.split()[0] in convo, ("his mate comes up in the room", convo)
    present_three(page)
    page.wait_for_selector(f"{WIN} .go-answer", timeout=10_000)
    labels = page.eval_on_selector_all(f"{WIN} .go-answer .go-answer-label", "els => els.map(e => e.textContent.trim())")
    assert labels == ["Tell Him Straight", "Promise Him an Offer", "Sidestep It"], labels
    lines = page.eval_on_selector_all(f"{WIN} .go-answer .go-answer-line", "els => els.map(e => e.textContent.trim())")
    assert lines[0] == f"I can't promise {mate} a spot today. I'll look at him." and lines[1] == f"{mate} gets an offer this week. You have my word.", lines
    assert mate in page.inner_text(f"{WIN} .go-question-line"), "his question names his mate"
    heights = page.eval_on_selector_all(f"{WIN} .go-answer", "els => els.map(e => e.getBoundingClientRect().height)")
    assert all(h >= 44 for h in heights), heights
    shot(page, "1280-package")
    page.click(f"{WIN} .go-answer[data-answer=promise]")
    page.wait_for_selector(f"{WIN} .go-question-reply", timeout=30_000)
    time.sleep(0.3)
    assert page.inner_text(f"{WIN} .go-question-reply").strip() == "Then we'll be watching for it."
    assert not page.query_selector(f"{WIN} .go-answer"), "the answers leave once you answered"
    pitch(page)
    page.click(f"{WIN} .go-scene-close")
    page.wait_for_selector(WIN, state="hidden", timeout=10_000)
    time.sleep(0.6)
    page.click(".go-pane .go-subtabs button[data-sub=history]")
    page.wait_for_selector(".go-pane .go-history-rows", timeout=10_000)
    time.sleep(0.4)
    lines = page.eval_on_selector_all(".go-pane .go-history-rows li", "els => els.map(e => e.dataset.line)")
    assert any(f"Promised an offer to {mate}" in t for t in lines), lines
    ctx.close()


def phone(browser, base, sid, pids, names, errs) -> None:
    ctx = browser.new_context(viewport={"width": 400, "height": 860}, device_scale_factor=2, color_scheme="dark", has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    pid = pids[2]
    open_board(page, base, sid)
    page.click(f".go-row-recruit[data-pid='{pid}']")
    page.wait_for_selector(".go-pane.sheet #rc-recruit", timeout=10_000)
    time.sleep(0.5)
    start_call(page)
    # the window fills the screen: the panel covers its whole fixed layer, which covers the viewport (the headless
    # browser's classic scrollbar keeps a gutter that a phone's overlay scrollbar does not)
    box = page.eval_on_selector(f"{WIN} .modal-panel", """e => { const r = e.getBoundingClientRect(), l = e.closest('.modal').getBoundingClientRect();
        return [r.left, r.top, r.width, r.height, l.width, l.height, innerWidth, innerHeight]; }""")
    assert abs(box[0]) <= 1 and abs(box[1]) <= 1 and abs(box[2] - box[4]) <= 1 and abs(box[3] - box[5]) <= 1, box
    assert box[4] >= box[6] - 16 and abs(box[5] - box[7]) <= 1, box
    close_h = page.eval_on_selector(f"{WIN} .modal-close", "e => e.getBoundingClientRect().height")
    assert close_h >= 44, close_h
    # Escape before the pitch keeps the call open
    page.keyboard.press("Escape")
    page.wait_for_selector(".go-pane.sheet #rc-finish", timeout=10_000)
    assert not page.query_selector(".go-scene")
    page.click(".go-pane.sheet #rc-finish")
    page.wait_for_selector(f"{WIN} .go-opening .go-opening-pick", timeout=30_000)
    present_three(page)
    answer_if_asked(page)
    shot(page, "400-mid")
    pitch(page)
    done_h = page.eval_on_selector(f"{WIN} .go-scene-close", "e => e.getBoundingClientRect().height")
    assert done_h >= 44, done_h
    shot(page, "400-after")
    # Escape after his reaction ends it for good
    page.keyboard.press("Escape")
    page.wait_for_selector(WIN, state="hidden", timeout=10_000)
    time.sleep(0.6)
    no_scene_on_page(page, "after Escape on a finished call")
    assert not page.query_selector(".go-pane #rc-finish")
    assert page.query_selector(".go-pane.sheet"), "the sheet stays on him"
    ctx.close()


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("scene window skipped: Playwright is not installed")
        raise SystemExit(0)
    sid, pids, names = make_career()
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
                print(f"scene window skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            desktop(browser, base, sid, pids, names, errs)
            phone(browser, base, sid, pids, names, errs)
            package_visit(browser, base, sid, pids, names, errs)
            browser.close()
        assert not errs, errs
        print("scene window ok: the call opens in its own dialog, plays through, Done ends it for good, Finish and a refresh reopen an unfinished one, "
              "a Package Deal's visit asks about his mate with its own three answers, 1280 and 400")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
