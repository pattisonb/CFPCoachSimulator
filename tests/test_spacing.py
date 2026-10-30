"""The spacing pass (spec section 9): on every Coach Career screen, at 1280 and 400 px, a container
holding two or more buttons keeps at least 8 px between them and one holding two or more tags at
least 6 px, no button or tag sits closer than 6 px to another on its row whatever their parents, nothing
overlaps, every card keeps 12 px of padding, and every button is at least 36 px tall (44 px on a phone). Segment
controls (.go-seg, .go-stages, .go-subtabs, nav.tabs) touch by design and are left out.

Walks a mid-season career (Office, Recruiting board, the pane with a recruit selected, the Recruit menu open,
the pitch step open and a call scene, Prospects and a profile, Staff,
Depth chart, Schedule) and a finished one (Classes, Summary, then every offseason stage reached
through /offseason/advance), plus the Seasons list and Your coach. Set SPACING_SHOTS=<folder> to
also save a screenshot of every screen at both widths in light and dark. Needs Playwright with a
Chromium; skipped without one. (Run as a file.)"""
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch   # noqa: E402

WIDTHS = (1280, 400)
EXCLUDED = ".go-seg, .go-stages, .go-subtabs, nav.tabs"
ITEM = "button, .go-tag, .go-badge, .go-word, .go-chip"
# every button is a tap target, except the depth chart's compact .tiny controls (28 px by their own rule, a recorded
# exception), the coach's color swatches (28 px circles), the week strip (navigation, like a segment control) and text
# links (.go-link, .btn-link, or any button inside running text); segments are left out through EXCLUDED
ACTION = "button:not(.tiny, .swatch, .week-chip, .go-link, .btn-link)"
# a button inside running text: its parent holds words of its own, or it is a text link laid out inline
IN_TEXT = """(e) => (e.matches('button') && [...e.parentElement.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
  || (e.matches('.go-link, .btn-link') && getComputedStyle(e).display.startsWith('inline'))"""
# card-like containers keep at least 12 px of padding on every side
CARDS = ".go-card, .coach-item, .leader-card, .start-card, .team-card, .bowl-card, .review-card, .rc-staff-card, .history-list li"

# an element clipped out of a scrolling ancestor's box (a list that scrolls inside itself) is not on screen
CLIPPED = """(e) => { const r = e.getBoundingClientRect();
  for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowY;
    if (o === 'auto' || o === 'scroll' || o === 'hidden') { const b = a.getBoundingClientRect(); if (r.bottom <= b.top + 0.5 || r.top >= b.bottom - 0.5) return true; } }
  return false; }"""

# every container with two or more visible buttons or tags as direct children: the gap between each pair
# (8 px for buttons, 6 px for tags; within 0.5 px counts as touching) and no overlap
GAPS_JS = """([SCREEN, ITEM, EXCLUDED]) => {
  const inText = """ + IN_TEXT + """;
  const clipped = """ + CLIPPED + """;
  const bad = [];
  const shown = (e) => (e.offsetParent !== null || getComputedStyle(e).position === 'fixed') && !clipped(e);
  const name = (e) => { const one = (x) => x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + [...x.classList].map(c => '.' + c).join('');
    const p = e.parentElement; return (p && p !== document.body ? one(p) + ' > ' : '') + one(e); };
  for (const g of document.querySelectorAll('*')) {
    if (g.closest(EXCLUDED) || !shown(g)) continue;
    const kids = [...g.children].filter(c => c.matches(ITEM) && shown(c) && c.getClientRects().length && !c.matches(EXCLUDED) && !inText(c));
    if (kids.length < 2) continue;
    const isTag = kids.every(k => !k.matches('button')); const need = isTag ? 6 : 8;
    const rects = kids.map(k => k.getBoundingClientRect());
    let worst = null;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (!a.width || !b.width) continue;
      const overlap = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      const sameRow = Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2;
      const gap = sameRow ? Math.max(b.left - a.right, a.left - b.right) : Math.max(b.top - a.bottom, a.top - b.bottom);
      if (overlap || gap < need - 0.5) {
        if (!worst || gap < worst.gap || overlap) worst = {screen: SCREEN, container: name(g), gap: Math.round(gap * 10) / 10, need, overlap,
          items: [kids[i], kids[j]].map(k => k.textContent.trim().replace(/\\s+/g, ' ').slice(0, 24))};
      }
    }
    if (worst) bad.push(worst);
  }
  return bad;
}"""

# every button and tag on the page, whatever its parent: two on the same row (vertical overlap at least half the smaller
# height) keep 6 px apart and nothing overlaps; one inside the other is not a pair, and neither is a pair on different
# layers (a sticky topbar or pane, a fixed sheet or dialog, over the page it scrolls past), nor one scrolled out of a
# list that scrolls inside itself (the scouting queue) with what sits under the list
PAIRS_JS = """([SCREEN, ITEM, EXCLUDED]) => {
  const inText = """ + IN_TEXT + """;
  const clipped = """ + CLIPPED + """;
  const shown = (e) => (e.offsetParent !== null || getComputedStyle(e).position === 'fixed') && !clipped(e);
  const one = (x) => x.tagName.toLowerCase() + [...x.classList].map(c => '.' + c).join('') + ` "${x.textContent.trim().replace(/\\s+/g, ' ').slice(0, 20)}"`;
  const els = [...document.querySelectorAll(ITEM)].filter(e => shown(e) && !e.closest(EXCLUDED) && e.getClientRects().length && !inText(e));
  const boxes = els.map(e => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width && r.height).sort((x, y) => x[1].left - y[1].left);
  const layers = new Map();
  const layer = (e) => { if (!layers.has(e)) { let l = null; for (let x = e; x; x = x.parentElement) { const p = getComputedStyle(x).position;
    if (p === 'fixed' || p === 'sticky' || x.tagName === 'DIALOG') { l = x; break; } } layers.set(e, l); } return layers.get(e); };
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [ea, a] = boxes[i], [eb, b] = boxes[j];
    if (b.left - a.right >= 6) continue;   // sorted by left: b is far enough right of a (later boxes may still be closer)
    if (layer(ea) !== layer(eb)) continue;
    if (ea.contains(eb) || eb.contains(ea)) continue;
    const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (vOverlap < Math.min(a.height, b.height) / 2) continue;
    const gap = Math.max(b.left - a.right, a.left - b.right);
    const overlap = gap < -0.5;
    if (overlap || gap < 5.5) bad.push({screen: SCREEN, pair: one(ea) + ' | ' + one(eb), gap: Math.round(gap * 10) / 10, overlap});
  }
  return bad;
}"""

# every card-like container keeps 12 px of padding on every side
CARDS_JS = """([SCREEN, CARDS]) => [...document.querySelectorAll(CARDS)]
  .filter(c => c.offsetParent !== null || getComputedStyle(c).position === 'fixed')
  .map(c => { const st = getComputedStyle(c); const pad = Math.min(...['Top', 'Right', 'Bottom', 'Left'].map(k => parseFloat(st['padding' + k])));
    return {screen: SCREEN, card: c.tagName.toLowerCase() + [...c.classList].map(k => '.' + k).join(''), padding: pad}; })
  .filter(c => c.padding < 11.5)"""

# every visible button is a tap target: 44 px on a phone, 36 px on a desktop (segments excepted)
TOUCH_JS = """([SCREEN, ACTION, EXCLUDED, MIN]) => { const inText = """ + IN_TEXT + """; return [...document.querySelectorAll(ACTION)]
  .filter(b => b.offsetParent !== null && !b.closest(EXCLUDED) && !inText(b) && b.getBoundingClientRect().height < MIN - 0.5)
  .map(b => { const text = b.textContent.trim().replace(/\\s+/g, ' ').slice(0, 30);
    return {screen: SCREEN, button: b.tagName.toLowerCase() + [...b.classList].filter(c => !/^(on|active|current|future|next|short|full|selected)$/.test(c)).map(c => '.' + c).join(''),
            text, height: Math.round(b.getBoundingClientRect().height)}; }); }"""


class Walk:
    def __init__(self, page, shots):
        self.page, self.shots = page, shots
        self.gaps, self.touch, self.pairs, self.cards, self.seen = [], [], [], [], []

    def measure(self, screen: str, width: int) -> None:
        label = f"{screen}@{width}"
        self.seen.append(label)
        time.sleep(0.4)
        self.gaps += self.page.evaluate(GAPS_JS, [label, ITEM, EXCLUDED])
        self.pairs += self.page.evaluate(PAIRS_JS, [label, ITEM, EXCLUDED])
        self.cards += self.page.evaluate(CARDS_JS, [label, CARDS])
        self.touch += self.page.evaluate(TOUCH_JS, [label, ACTION, EXCLUDED, 44 if width < 760 else 36])
        if self.shots:
            self.page.evaluate("() => window.scrollTo(0, 0)")
            for theme in ("dark", "light"):
                self.page.evaluate("(t) => { document.documentElement.dataset.theme = t; }", theme)
                time.sleep(0.15)
                self.page.screenshot(path=str(Path(self.shots) / f"{screen.replace(':', '-')}-{width}-{theme}.png"), full_page=True)
            self.page.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }")

    def both(self, screen: str, render) -> None:
        for width in WIDTHS:
            self.page.set_viewport_size({"width": width, "height": 1000 if width > 760 else 860})
            render(width)
            self.measure(screen, width)


def open_tab(page, base, sid, tab, wait):
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#season:visible")
    page.evaluate("(t) => document.querySelector(`#season-tabs button[data-tab=${t}]`).click()", tab)
    page.wait_for_selector(wait, timeout=120_000)
    time.sleep(0.8)


def grouped(rows: list, key: str, worst: str) -> list:
    """One line per container (or button kind): the screens it is on, its worst value and an example."""
    out = {}
    for r in rows:
        g = out.setdefault(r[key], {**r, "screens": []})
        if r["screen"] not in g["screens"]:
            g["screens"].append(r["screen"])
        if r[worst] < g[worst]:
            g.update({k: v for k, v in r.items() if k != "screen"})
    return sorted(out.values(), key=lambda g: (-len(g["screens"]), g[key]))


def report(rows: list, keys: tuple) -> str:
    def screens(g):
        ss = g["screens"]
        return ", ".join(ss[:6]) + (f" (+{len(ss) - 6} more)" if len(ss) > 6 else "")
    return "\n".join("  " + "  ".join(f"{k}={g[k]}" for k in keys) + f"  on {screens(g)}" for g in rows)


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("spacing test skipped: Playwright is not installed")
        raise SystemExit(0)
    from sim import season
    from test_offseason import finished
    fresh = season.new_season("smu", "full", seed=62, career=True)
    season.save_season(fresh)
    done = season.new_season("ohio-state", "full", seed=8, career=True)
    finished(done)
    season.save_season(done)
    shots = os.environ.get("SPACING_SHOTS")
    if shots:
        Path(shots).mkdir(parents=True, exist_ok=True)
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
                print(f"spacing test skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.dismiss())
            w = Walk(page, shots)
            A, B = fresh["id"], done["id"]

            # --- the Seasons list and Your coach
            def seasons(_):
                page.goto(f"{base}/index.html")
                page.wait_for_selector("#btn-seasons")
                if page.get_attribute("#btn-seasons", "aria-pressed") != "true":
                    page.click("#btn-seasons")
                page.wait_for_function("() => !document.querySelector('#season-list').textContent.includes('Loading')", timeout=60_000)
            w.both("seasons", seasons)

            # the Seasons menu (a season open folds the toolbar into one button) and the compact header bar (past the card)
            def seasons_menu(_):
                page.goto(f"{base}/index.html?id={A}")
                page.wait_for_selector("#season:visible")
                page.click("#btn-seasons-menu")
                page.wait_for_selector(".go-menu .go-menu-item", timeout=30_000)
            w.both("seasons-menu", seasons_menu)

            def compact(_):
                open_tab(page, base, A, "depth", "[data-player]")      # a long page: it scrolls well past the header
                page.evaluate("() => window.scrollTo(0, 800)")
                page.wait_for_selector("#season-compact:visible", timeout=30_000)
            w.both("season-compact", compact)

            def coach(_):
                page.goto(f"{base}/coach.html")
                page.wait_for_selector("#coach-form button, #coach-form input", timeout=60_000)
            w.both("coach", coach)

            # --- the mid-season career: fill the board with the recommended prospects first, as the sweep does
            open_tab(page, base, A, "prospects", ".go-list-row")
            page.click("button.go-chip:has-text('Recommended for you')")
            page.wait_for_selector("button.go-btn:has-text('Add these')", timeout=120_000)
            page.click("button.go-btn:has-text('Add these')")
            time.sleep(4)
            for tab, wait in (("office", ".go-program"), ("recruiting", ".go-row-recruit"), ("prospects", ".go-list-row"),
                              ("scouting", ".sc-scout"), ("depth", "[data-player]"), ("schedule", ".schedule-pick")):
                w.both(tab, lambda _w, tab=tab, wait=wait: open_tab(page, base, A, tab, wait))

            # the new board: a recruit selected (a full-screen pane on a phone), the Recruit menu open (a bottom sheet on a
            # phone), the pitch step open, then a call scene (last: an open call makes every menu item wait)
            def pane(_):
                open_tab(page, base, A, "recruiting", ".go-row-recruit")
                page.click(".go-row-recruit >> nth=0")
                page.wait_for_selector(".go-pane .go-subtabs", timeout=30_000)
            w.both("recruiting-pane", pane)

            def menu(_):
                pane(_)
                page.click(".go-pane #rc-recruit")
                page.wait_for_selector(".go-menu .go-menu-item", timeout=30_000)
            w.both("recruiting-menu", menu)

            def step(_):
                menu(_)
                page.click(".go-menu .go-menu-item[data-action=offer]")
                page.wait_for_selector(".go-pane .go-step #rc-pitch", timeout=30_000)
            w.both("recruiting-step", step)

            def scene(_):
                pane(_)
                fin = page.query_selector(".go-pane #rc-finish")
                if fin:
                    fin.click()
                else:
                    page.click(".go-pane #rc-recruit")
                    page.click(".go-menu .go-menu-item[data-action=call]")
                page.wait_for_selector(".go-pane .go-scene .go-scene-line.cue", timeout=30_000)
            w.both("recruiting-scene", scene)

            def profile(_):
                open_tab(page, base, A, "prospects", ".go-list-row")
                page.click(".go-list-row .go-list-id >> nth=0")
                page.wait_for_selector(".go-profile .go-display", timeout=60_000)
            w.both("prospect-profile", profile)

            # --- the finished career: Classes, Summary, then every offseason stage
            w.both("classes", lambda _: open_tab(page, base, B, "classes", ".go-class"))
            w.both("summary", lambda _: open_tab(page, base, B, "summary", "#tab-summary .review-card"))
            for _ in range(12):
                stage = call(base, f"/api/season/{B}/offseason")["stage"]
                def offseason(_):
                    page.goto(f"{base}/index.html?id={B}")
                    page.wait_for_selector("#tab-offseason .off-steps", timeout=120_000)
                    time.sleep(0.8)
                w.both(f"offseason:{stage}", offseason)
                if stage == "ready":
                    break
                call(base, f"/api/season/{B}/offseason/advance", {})
            browser.close()
        print(f"walked {len(w.seen)} screens: {', '.join(w.seen)}")
        assert not errors, errors
        assert any(s.startswith("offseason:ready") for s in w.seen), "the walk reached the ready stage"
        problems = []
        if w.gaps:
            problems.append(f"{len(w.gaps)} cramped or overlapping containers, by kind:\n" + report(grouped(w.gaps, "container", "gap"), ("container", "gap", "need", "overlap", "items")))
        if w.pairs:
            problems.append(f"{len(w.pairs)} buttons or tags closer than 6 px on a row, any parent:\n" + report(grouped(w.pairs, "pair", "gap"), ("pair", "gap", "overlap")))
        if w.cards:
            problems.append(f"{len(w.cards)} cards with under 12 px padding:\n" + report(grouped(w.cards, "card", "padding"), ("card", "padding")))
        if w.touch:
            problems.append(f"{len(w.touch)} buttons under 44 px on a phone or 36 px on a desktop, by kind:\n" + report(grouped(w.touch, "button", "height"), ("button", "height", "text")))
        assert not problems, "\n".join(problems)
        print("spacing ok: every button row keeps 8 px, every tag row 6 px, no two on a row closer than 6 px, nothing overlaps, cards pad 12 px, buttons are 36 px (44 px on a phone)")
    finally:
        for sid in (fresh["id"], done["id"]):
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
        server.terminate()
