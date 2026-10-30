"""Smoothness, measured: an action patches the screen in place, it does not rebuild it. For every
action on the Office, the depth chart (a move, a redshirt, a position change), Settings, the
recruiting board (a message, an offer, a scout), each
offseason stage's decision buttons (the AD's review, a redshirt, a position change, a retention
offer, a portal offer, letting a coach go, a hire, the job choice when there is one) and Your
coach's save, driven through the real page: the element the player is looking at stays connected,
no node holding it is removed while the action lands (a MutationObserver installed before the
click), the page and its scrolling boxes stay within 2 px, a toast says what happened, and focus
ends on a control, never the page body. A reduced-motion run: no pulse and no transition.
Spec: docs/superpowers/specs/2026-10-30-smoothness-design.md, section 5. Needs Playwright with a
Chromium; skipped without one. (Run as a file.)"""
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
from test_ux_sweep import open_tab                     # noqa: E402

CONTROLS = ("BUTTON", "SELECT", "INPUT", "A", "TEXTAREA")

INSTALL = """(target) => {
  const st = window.__smooth = { removals: 0, pulses: 0, toastsBefore: new Set(document.querySelectorAll('#toasts > *')) };
  st.obs = new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === 'childList') { for (const n of r.removedNodes) if (n === target || (n.contains && n.contains(target))) st.removals++; }
      else if (r.target.classList && r.target.classList.contains('go-changed')) st.pulses++;
    }
  });
  st.obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  st.scrollers = [];
  for (let e = target.parentElement; e; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY;
    if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) st.scrollers.push(e);
  }
  st.scroll = [window.scrollY, ...st.scrollers.map((e) => e.scrollTop)];
  st.height = document.documentElement.scrollHeight;
  st.top = target.getBoundingClientRect().top;
}"""

TOAST_SEEN = """(pat) => [...document.querySelectorAll('#toasts > *')].some((t) => !window.__smooth.toastsBefore.has(t) && new RegExp(pat).test(t.textContent.trim()))"""

RESULT = """(target) => {
  const st = window.__smooth; st.obs.disconnect();
  const a = document.activeElement;
  return { connected: target.isConnected, removals: st.removals, pulses: st.pulses,
           scroll: [window.scrollY, ...st.scrollers.map((e) => e.scrollTop)], before: st.scroll,
           height: [st.height, document.documentElement.scrollHeight], top: [st.top, target.getBoundingClientRect().top],
           focus: a ? a.tagName : null, focusLive: !!(a && a.isConnected),
           toasts: [...document.querySelectorAll('#toasts > *')].map((t) => t.textContent.trim()) };
}"""


def assert_smooth(page, watched_selector: str, action_fn, toast_text, what: str) -> dict:
    """The generic check of spec section 5 around one action. toast_text: the exact sentence, a
    compiled regex, or None for a control that changes nothing but the view."""
    handle = page.wait_for_selector(watched_selector, timeout=60_000)
    page.evaluate(INSTALL, handle)
    action_fn()
    if toast_text is not None:
        pat = toast_text.pattern if isinstance(toast_text, re.Pattern) else f"^{re.escape(toast_text)}$"
        try:
            page.wait_for_function(TOAST_SEEN, arg=pat, timeout=60_000)
        except Exception:  # noqa: BLE001 - say which toast was missing and what was there
            raise AssertionError(f"{what}: no toast matching {pat!r}; on screen: "
                                 f"{page.evaluate('() => [...document.querySelectorAll(\"#toasts > *\")].map(t => t.textContent)')} "
                                 f"#toast={page.evaluate('() => (document.getElementById(\"toast\") || {}).textContent')!r}")
    page.wait_for_function("() => !document.querySelector('.go-busy')", timeout=60_000)
    time.sleep(0.5)      # anything a late redraw would do lands here
    r = page.evaluate(RESULT, handle)
    assert r["connected"], f"{what}: the element the player was looking at ({watched_selector}) left the page"
    assert r["removals"] == 0, f"{what}: {r['removals']} removal(s) of a node holding {watched_selector}"
    drift = [abs(a - b) for a, b in zip(r["scroll"], r["before"])]
    # the scroll stays, or the browser's scroll anchoring moved it by exactly what grew above, so the
    # element the player looks at holds its place on screen (Your coach: a new row in the list above the form)
    anchored = drift and drift[0] > 2 and all(d <= 2 for d in drift[1:]) and abs(r["top"][1] - r["top"][0]) <= 2 \
        and abs((r["scroll"][0] - r["before"][0]) - (r["height"][1] - r["height"][0])) <= 2
    assert len(r["scroll"]) == len(r["before"]) and (all(d <= 2 for d in drift) or anchored), \
        f"{what}: scroll moved {r['before']} -> {r['scroll']} (page height {r['height']}, its top {r['top']})"
    assert r["focus"] in CONTROLS and r["focusLive"], f"{what}: focus ended on {r['focus']}, not a control"
    return r


def center(h) -> None:
    """Mid-screen, clear of the sticky bars (a click on a covered control makes Playwright scroll again)."""
    h.evaluate("e => e.scrollIntoView({ block: 'center' })")


def ready(page, selector: str):
    """The control, scrolled into view before anything is measured (Playwright's own click scrolls otherwise)."""
    h = page.wait_for_selector(selector, timeout=60_000)
    center(h)
    time.sleep(0.2)
    return h


def check_toast_stack(page) -> None:
    """The stack: a polite status region bottom-left, three at most, newest on top; the hidden #toast mirror keeps the latest."""
    page.evaluate("() => { for (let i = 1; i <= 5; i++) window.CFP.ui.toast(`stack ${i}`, { ms: 4000 }); }")
    time.sleep(0.4)
    st = page.evaluate("""() => { const b = document.getElementById('toasts'), r = b.getBoundingClientRect(), m = document.getElementById('toast');
      return { role: b.getAttribute('role'), live: b.getAttribute('aria-live'), texts: [...b.children].filter(t => !t.classList.contains('go-leaving')).map(t => t.textContent),
               left: r.left, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight,
               mirror: m && m.textContent, mirrorHidden: m && m.hidden, mirrorShown: m && getComputedStyle(m).display !== 'none' }; }""")
    assert st["role"] == "status" and st["live"] == "polite", st
    assert st["texts"] == ["stack 5", "stack 4", "stack 3"], st["texts"]
    assert st["left"] < st["w"] / 2 and st["right"] <= st["w"] * 0.6 and st["h"] - st["bottom"] < 80, f"the stack sits bottom-left: {st}"
    assert st["mirror"] == "stack 5" and st["mirrorHidden"] is False and not st["mirrorShown"], st
    page.evaluate("() => document.querySelectorAll('#toasts > *').forEach((t) => t.remove())")


def check_reconcile(page) -> None:
    """CFP.ui.reconcile keeps keyed nodes (patched, moved into order), draws new ones and fades out the gone; busy restores and refocuses."""
    r = page.evaluate("""async () => {
      const ui = window.CFP.ui, box = document.createElement('div'); document.body.append(box);
      const draw = (r) => { const n = document.createElement('p'); n.textContent = r.t; return n; };
      const patched = [];
      const first = ui.reconcile(box, [{ id: 'a', t: 'A' }, { id: 'b', t: 'B' }, { id: 'c', t: 'C' }], 'id', draw, (n, r) => { n.textContent = r.t; });
      const second = ui.reconcile(box, [{ id: 'c', t: 'C2' }, { id: 'a', t: 'A' }, { id: 'd', t: 'D' }], (r) => r.id, draw, (n, r) => { patched.push(r.id); n.textContent = r.t; });
      await new Promise((ok) => setTimeout(ok, 400));
      const out = { order: [...box.children].map((n) => n.dataset.key + ':' + n.textContent), kept: second[0] === first[2] && second[1] === first[0], patched };
      const b = document.createElement('button'); b.textContent = 'go'; box.append(b); b.focus();
      const p = ui.busy(b, new Promise((ok) => setTimeout(ok, 100)));
      out.during = [b.disabled, b.classList.contains('go-busy')];
      await p;
      out.after = [b.disabled, b.classList.contains('go-busy'), document.activeElement === b];
      box.remove();
      return out; }""")
    assert r["order"] == ["c:C2", "a:A", "d:D"] and r["kept"] and r["patched"] == ["c", "a"], r
    assert r["during"] == [True, True] and r["after"] == [False, False, True], r


def season_cases(page, base: str, sid: str) -> None:
    # --- the Office: its one in-place control (every program) opens without a redraw
    open_tab(page, base, sid, "office", ".go-program")
    check_toast_stack(page)
    check_reconcile(page)
    more = ready(page, ".go-program-foot button")
    assert_smooth(page, ".go-office", lambda: more.click(), None, "Office: every program")

    # --- Settings over the depth chart: god mode does not redraw the chart behind the dialog
    open_tab(page, base, sid, "depth", ".depth-table [data-player]")
    page.evaluate("() => window.scrollTo(0, 400)")
    page.click("#btn-settings")
    page.wait_for_selector(".modal-body .settings")
    god = ready(page, ".settings-row:has-text('God mode') .switch")
    assert_smooth(page, ".depth-table", lambda: god.click(),
                  re.compile(r"^God mode (on: open any player or depth chart to edit it|off)\.$"), "Settings: god mode")
    morale = ready(page, ".settings-row:has-text('Momentum and morale') .switch")
    assert_smooth(page, ".modal-body .settings", lambda: morale.click(),
                  re.compile(r"^Momentum and morale (on from the next sim|off)\.$"), "Settings: morale")
    page.keyboard.press("Escape")
    page.wait_for_selector("#modal", state="hidden")

    # --- depth chart: a move by keyboard; focus comes back to the same control
    sel = ".depth-table td.depth-cell:nth-child(4) button[aria-label='Move up']"
    btn = page.wait_for_selector(sel)
    name = btn.evaluate("b => b.closest('.depth-cell').querySelector('[data-player]').textContent")
    role = btn.evaluate("b => b.closest('tr').querySelector('.depth-role b').textContent")
    center(btn)
    btn.focus()
    r = assert_smooth(page, ".depth-table", lambda: page.keyboard.press("Enter"), f"{name} moves up at {role}", "Depth chart: move up")
    assert btn.evaluate("b => b.isConnected && document.activeElement === b"), "focus returns to the same Move up button"
    assert r["pulses"] > 0, "the moved players' cells pulse"

    # --- depth chart: a redshirt
    rs = page.wait_for_selector(".depth-table .depth-rs:not(.on)")
    name = rs.evaluate("b => b.closest('.depth-cell').querySelector('[data-player]').textContent")
    center(rs)
    assert_smooth(page, ".depth-redshirts", lambda: rs.click(), f"Redshirt: {name}", "Depth chart: redshirt")
    assert name in page.inner_text(".depth-redshirts"), "the redshirt list shows him"
    back = page.wait_for_selector(".depth-redshirt .depth-rs.on")
    assert_smooth(page, ".depth-redshirts", lambda: back.click(), f"Off redshirt: {name}", "Depth chart: off redshirt")

    # --- depth chart, by position: a position change (into the QB rotation)
    page.click("#tab-depth .view-chips button:has-text('By position')")
    add = page.wait_for_selector("#tab-depth button[aria-label=\"Add to this spot's rotation\"]", timeout=60_000)
    name = add.evaluate("b => [...b.closest('tr').cells[1].querySelector('.name').childNodes].find((n) => n.nodeType === 3).textContent")
    center(add)
    assert_smooth(page, "#tab-depth table.stats", lambda: add.click(), f"{name} joins the QB rotation", "Depth chart: position change")


def board_cases(page, base: str, sid: str) -> None:
    """The recruiting board: Message (the step's Send), Offer and Scout (a menu item) patch the pane in place."""
    rows = call(base, f"/api/season/{sid}/prospects?status=open&limit=40")["rows"]
    for r in rows[:14]:                     # a board of fourteen uncommitted prospects (no hours): the list outruns the pane, as a real board does
        call(base, f"/api/season/{sid}/board", {"pid": r["id"], "on": True})
    open_tab(page, base, sid, "recruiting", ".go-stages")
    v = call(base, f"/api/season/{sid}/recruiting")
    assert v["hours_left"] >= 25, v["hours_left"]
    b = next(x for x in v["board"] if not x["offered"] and not x["committed"] and not x["signed"] and not x.get("scene") and not (x.get("trips") or 0))
    page.click(f".go-row-recruit[data-pid='{b['id']}']")
    time.sleep(1.2)                       # the pick's own smooth scroll ends
    page.evaluate("() => window.scrollTo(0, Math.max(window.scrollY, 120))")
    time.sleep(0.3)

    def menu(action):
        page.click("#rc-recruit")
        page.wait_for_selector(".go-menu[role=menu]")
        page.click(f".go-menu .go-menu-item[data-action={action}]")

    menu("message")
    send = ready(page, ".go-pane .go-step button.go-step-go")
    assert_smooth(page, ".go-pane", lambda: send.click(), f"Message sent to {b['name']} · 5 hours", "Board: message")
    assert not page.query_selector(".go-pane .go-step"), "the step closes once the message is sent"
    menu("offer")
    page.wait_for_selector(".go-pane .go-step input#rc-nil")
    nil = int(page.input_value("#rc-nil"))
    send = ready(page, ".go-pane .go-step button.go-step-go")
    r = assert_smooth(page, ".go-pane", lambda: send.click(), f"Offer sent to {b['name']} · {nil} NIL", "Board: offer")
    assert r["pulses"] > 0, "the NIL cell and the Offered tag pulse"
    page.wait_for_function("(t) => [...document.querySelectorAll('.go-pane .go-tags .go-tag')].some(e => e.textContent.trim() === t)", arg=f"Offered · {nil} NIL", timeout=10_000)
    assert_smooth(page, ".go-pane", lambda: menu("scout"), f"Scouted {b['name']} · look 1 of 3", "Board: scout")
    assert page.evaluate("() => document.activeElement.id") == "rc-recruit", "the Recruit button gets the focus back"
    assert "1 of 3 looks" in page.inner_text(".go-pane .go-strip")


def offseason_cases(page, base: str, sid: str) -> None:
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#tab-offseason .off-roster", timeout=120_000)
    time.sleep(0.6)
    # the AD's review
    case = ready(page, ".off-review-acts button.go-act:has-text('Make your case')")
    assert_smooth(page, ".off-review", lambda: case.click(),
                  "You make your case to the AD", "Offseason: the review")
    # a redshirt at Departures
    b = ready(page, ".off-rs button.go-act:not([disabled])")
    name = b.evaluate("b => b.querySelector('b').textContent")
    assert_smooth(page, ".off-roster", lambda: b.click(), re.compile(rf"^(Redshirt|Plays on): {re.escape(name)}$"), "Offseason: redshirt")
    # a position change
    page.select_option(".off-roster select.go-sel", index=1)
    chip = ready(page, ".off-pos-opts button:not([disabled])")
    who = page.eval_on_selector(".off-roster select.go-sel", "s => s.options[s.selectedIndex].textContent.split(' · ')[1]")
    picked = page.eval_on_selector(".off-roster select.go-sel", "s => s.value")
    pos = chip.inner_text().split()[0]
    assert_smooth(page, ".off-roster", lambda: chip.click(), f"{who} moves to {pos}", "Offseason: position change")
    assert page.eval_on_selector(".off-roster select.go-sel", "s => s.value") == picked, "the picker keeps the player"

    # Keep them home: meet, then an NIL offer
    call(base, f"/api/season/{sid}/offseason/advance", {})
    assert call(base, f"/api/season/{sid}/offseason")["stage"] == "retention"
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector(".off-keep .go-pcard", timeout=120_000)
    time.sleep(0.6)
    card = ".off-keep .go-pcard >> nth=0"
    name = page.inner_text(f"{card} >> .go-name")
    meet = ready(page, f"{card} >> button.go-act:has-text('Meet')")
    assert_smooth(page, ".off-keep .go-pcard", lambda: meet.click(), f"Met with {name}", "Offseason: meet")
    page.fill(f"{card} >> input.go-nil", "5")             # within next year's budget
    nil = "5"
    offer = ready(page, f"{card} >> button.go-act:has-text('Offer NIL')")
    assert_smooth(page, ".off-keep .go-pcard", lambda: offer.click(),
                  f"Offer to {name} · {int(nil)} NIL", "Offseason: retention offer")

    # after the patches the stage's own button still acts on the screen (its handler is the live one)
    page.click("#tab-offseason .off-actions .go-btn.primary")
    page.wait_for_selector("text=WEEK 1 OF 4", timeout=120_000)

    # Staff: let a coach go, hire his replacement
    for _ in range(8):
        if call(base, f"/api/season/{sid}/offseason")["stage"] == "staff":
            break
        call(base, f"/api/season/{sid}/offseason/advance", {})
    assert call(base, f"/api/season/{sid}/offseason")["stage"] == "staff"
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("text=YOUR STAFF", timeout=120_000)
    time.sleep(0.6)
    staff = ".off-grid > section.go-card >> nth=0"
    lg = page.query_selector(".off-letgo button.go-act")
    if lg:
        center(lg)
        who = lg.evaluate("b => b.firstChild.textContent")
        page.once("dialog", lambda d: d.accept())
        assert_smooth(page, staff, lambda: lg.click(), f"{who} is out · hire his replacement", "Offseason: let a coach go")
    cand = ready(page, ".off-cands .off-cand:not(.picked)")
    cname = cand.evaluate("b => b.querySelector('b').textContent.split(',')[0]")
    assert_smooth(page, staff, lambda: cand.click(), re.compile(rf"^Hired {re.escape(cname)} as [A-Z]+$"), "Offseason: hire")


def portal_case(page, base: str, sid: str) -> None:
    """The two-round portal of older saves: an offer from its table."""
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector(".off-table tbody button.go-btn.primary", timeout=120_000)
    time.sleep(0.6)
    b = ready(page, ".off-table tbody button.go-btn.primary")
    name = b.evaluate("b => b.closest('tr').cells[0].querySelector('b').textContent")
    assert_smooth(page, ".off-scroll", lambda: b.click(), f"Offer sent to {name}", "Offseason: portal offer")


def job_case(page, base: str, sid: str) -> None:
    """A coach the AD let go picks his next job at the Staff step."""
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("section.off-job .off-cand", timeout=120_000)
    time.sleep(0.6)
    b = ready(page, "section.off-job .off-cand")
    name = b.evaluate("b => b.querySelector('b').textContent.trim()")
    assert_smooth(page, "section.off-job", lambda: b.click(), f"Taking the job at {name}", "Offseason: the job")
    assert b.evaluate("b => b.classList.contains('picked') && document.activeElement === b"), "the job card is picked and keeps focus"


def coach_case(page, base: str) -> str:
    page.goto(f"{base}/coach.html")
    page.wait_for_selector(".coach-final button.primary", timeout=60_000)
    page.fill(".coach-grid input[placeholder=First]", "Smooth")
    page.fill(".coach-grid input[placeholder=Last]", "Saver")
    save = ready(page, ".coach-final button.primary")
    assert_smooth(page, "#coach-form > section.coach-final", lambda: save.click(), "Smooth Saver saved.", "Your coach: save")
    assert page.inner_text(".coach-final button.primary") == "Save changes"
    page.wait_for_selector(".coach-item:has-text('Smooth Saver')")
    return page.evaluate("() => new URLSearchParams(location.search).get('id')") or ""


def reduced_motion(browser, base: str, sid: str) -> None:
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        open_tab(page, base, sid, "depth", ".depth-table [data-player]")
        btn = page.wait_for_selector(".depth-table td.depth-cell:nth-child(4) button[aria-label='Move up']")
        name = btn.evaluate("b => b.closest('.depth-cell').querySelector('[data-player]').textContent")
        role = btn.evaluate("b => b.closest('tr').querySelector('.depth-role b').textContent")
        center(btn)
        r = assert_smooth(page, ".depth-table", lambda: btn.click(), f"{name} moves up at {role}", "Reduced motion: move up")
        assert r["pulses"] == 0, "no pulse under reduced motion"
        probe = page.evaluate("""() => { const d = document.createElement('div'); d.className = 'go-changed go-fade-in'; document.body.append(d);
          const c = getComputedStyle(d), t = getComputedStyle(document.querySelector('#toasts > *') || d); const out = [c.transitionDuration, c.animationName, t.animationName]; d.remove(); return out; }""")
        assert probe == ["0s", "none", "none"], f"reduced motion still moves: {probe}"
        assert not errors, errors
    finally:
        ctx.close()


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("smoothness skipped: Playwright is not installed")
        raise SystemExit(0)
    from coach_career import offseason
    from sim import season
    from test_offseason import finished
    fresh = season.new_season("smu", "full", seed=62, career=True)
    season.save_season(fresh)
    done = season.new_season("ohio-state", "full", seed=8, career=True)
    finished(done)
    off = offseason.start(done)
    off["review"].update(risk="warning", options=["case", "nothing"], option_names={o: offseason.REVIEW_OPTIONS[o] for o in ("case", "nothing")},
                         decided=False, outcome=None)          # the AD wants a word: the review's buttons are on screen
    season.save_season(done)
    old = season.new_season("georgia", "full", seed=8, career=True)
    finished(old)
    offseason.start(old)
    old["offseason"]["stage"] = "portal_1"                     # a save from the two-round portal: offers from a table
    season.save_season(old)
    let_go = season.new_season("georgia", "full", seed=3, career=True)
    finished(let_go)
    lo = offseason.start(let_go)
    lo["review"].update(risk="fire", must=True, options=["case", "nothing"], decided=False, outcome=None)
    offseason.review_decide(let_go, "nothing")                 # the AD lets him go: the Staff step lists the openings
    lo["auto"] = False
    while lo["stage"] != "staff":
        offseason.advance(let_go)
    season.save_season(let_go)
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    coach_id = ""
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
                print(f"smoothness skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            season_cases(page, base, fresh["id"])
            board_cases(page, base, fresh["id"])
            offseason_cases(page, base, done["id"])
            portal_case(page, base, old["id"])
            job_case(page, base, let_go["id"])
            coach_id = coach_case(page, base)
            assert not errors, errors
            reduced_motion(browser, base, fresh["id"])
            browser.close()
        print("smoothness ok: office, settings, depth chart (move, redshirt, position), board (message, offer, scout), offseason (review, redshirt, position, "
              "keep them home, portal offer, staff, the job), your coach; reduced motion")
    finally:
        for sid in (fresh["id"], done["id"], old["id"], let_go["id"]):
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
        try:
            for c in call(base, "/api/coaches")["coaches"]:
                if c.get("first_name") == "Smooth" and c.get("last_name") == "Saver":
                    call(base, f"/api/coaches/{c['id']}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
        server.wait(timeout=30)
