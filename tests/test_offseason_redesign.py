"""The offseason's redesigned screens (web/offseason.js, the player's six mockups) in a browser, at 1280 and
400 px, light and dark, walking every stage of one career: the Overview, Keep Them Home, Departures, the four
portal weeks, Development, Staff and the Recap. On every page: the stage chip and the stepper agree with the
API's stage, each card shows the API's numbers, nothing reads null/undefined/NaN, the page never scrolls
sideways, labels are Title Case, cards in a row line up (tops within 1 px, each as tall as its content, a lone card spans the
row) with one gap everywhere, and Back and Advance still work. Screenshots of every page go to SHOT_DIR when
it is set. Needs Playwright with a Chromium; without one it is skipped. `python3 tests/test_offseason_redesign.py`"""
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

COMBOS = [("1280-dark", 1280, "dark"), ("1280-light", 1280, "light"), ("400-dark", 400, "dark")]
SHOT_DIR = os.environ.get("SHOT_DIR")
GAP = 16          # the one gap between cards, across and down (web/offseason.css --off-gap)

# every label on the page that the house rules make Title Case (the board's own labels belong to recruiting.js)
TITLE_CHECK = """() => {
  const SMALL = new Set(["a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by", "vs"]);
  const box = document.querySelector('#tab-offseason');
  const sel = ['.go-kicker', '.off-chip', '.off-step-name', '.off-tab', '.go-tag', 'th', '.off-stat-label', '.off-kv dt',
               'button.go-btn', '.go-act > b', '.off-title', 'summary .go-kicker'];
  const bad = [];
  for (const n of box.querySelectorAll(sel.join(','))) {
    // the board is recruiting.js's; a candidate card is one button of sentences; the Staff step's development reasons keep their case (.off-dev)
    if (n.closest('.off-board') || n.closest('.off-cand') || n.closest('.off-dev') || !n.offsetParent) continue;
    const c = n.cloneNode(true);
    for (const w of c.querySelectorAll('.go-info-wrap')) w.remove();        // the (i) tip's sentence is not the label
    const t = c.textContent.replace(/[→←✓⏭·:(),+−]/g, ' ').trim();
    const words = t.split(/\\s+/).filter(Boolean);
    words.forEach((w, i) => {
      if (!/^[a-z]/.test(w)) return;
      if (SMALL.has(w) && i > 0 && i < words.length - 1) return;
      bad.push(n.textContent.trim());
    });
  }
  return [...new Set(bad)];
}"""

# cards in a row: those side by side share a top and a bottom (1 px), a lone one spans the row; the gaps are GAP
ROW_CHECK = """(gap) => {
  const out = [];
  const vis = (n) => n.offsetParent !== null && n.getBoundingClientRect().height > 0;
  for (const row of document.querySelectorAll('#tab-offseason .off-row')) {
    if (!vis(row)) continue;
    const rr = row.getBoundingClientRect();
    const items = [...row.children].filter((n) => vis(n) && getComputedStyle(n).display !== 'contents');
    const lines = [];
    for (const n of items) {
      const r = n.getBoundingClientRect();
      const line = lines.find((l) => Math.abs(l.top - r.top) <= 1);
      if (line) line.items.push(r); else lines.push({ top: r.top, items: [r] });
    }
    for (const l of lines) {
      if (l.items.length === 1) {
        if (l.items[0].width < rr.width - 1) out.push(`a lone card ${Math.round(l.items[0].width)} of ${Math.round(rr.width)} px in ${row.className}`);
        continue;
      }
      // a card is as tall as its content (never padded out to its neighbor): the row's cards share a top and none runs past the row
      const b = l.items.map((r) => r.bottom);
      if (Math.max(...b) > rr.bottom + 1) out.push(`bottoms ${b.map(Math.round)} past the row's ${Math.round(rr.bottom)} in ${row.className}`);
      const xs = l.items.slice().sort((p, q) => p.left - q.left);
      for (let i = 1; i < xs.length; i++) { const g = xs[i].left - xs[i - 1].right; if (Math.abs(g - gap) > 1) out.push(`gap ${g} across in ${row.className}`); }
    }
    lines.sort((p, q) => p.top - q.top);
    for (let i = 1; i < lines.length; i++) {
      const prev = Math.max(...lines[i - 1].items.map((r) => r.bottom));
      const g = lines[i].top - prev;
      if (Math.abs(g - gap) > 1) out.push(`gap ${Math.round(g)} down in ${row.className}`);
    }
  }
  // the page's blocks, one under the other
  const page = document.querySelector('#tab-offseason .off-page');
  if (page) {
    const kids = [...page.children].filter(vis).map((n) => n.getBoundingClientRect());
    for (let i = 1; i < kids.length; i++) { const g = kids[i].top - kids[i - 1].bottom; if (Math.abs(g - gap) > 1) out.push(`gap ${Math.round(g)} between blocks ${i - 1} and ${i}`); }
  }
  return out;
}"""

BAD_WORDS = re.compile(r"\bnull\b|\bundefined\b|\bNaN\b|\[object Object\]")


def text(page, sel="#tab-offseason") -> str:
    return page.inner_text(sel)


def wait_page(page, name: str) -> None:
    page.wait_for_selector(f"#tab-offseason .off-page[data-page={name}]", timeout=180_000)
    page.wait_for_function("() => !document.querySelector('#tab-offseason .off-busy')", timeout=180_000)
    time.sleep(0.4)


def stepper_ok(page, v: dict) -> None:
    keys = [s["key"] for s in v["stages"]]
    cur = keys.index({"portal_1": "portal_w1", "portal_2": "portal_w2"}.get(v["stage"], v["stage"]))
    steps = page.query_selector_all("#tab-offseason .off-steps .off-step")
    assert len(steps) == len(keys), (len(steps), keys)
    now = [i for i, s in enumerate(steps) if "now" in (s.get_attribute("class") or "")]
    done = [i for i, s in enumerate(steps) if "done" in (s.get_attribute("class") or "")]
    assert now == [cur], (now, cur)
    assert done == list(range(cur)), done
    for i in done:
        assert steps[i].query_selector(".off-step-mark").inner_text().strip() == "✓"
    chip = page.inner_text("#tab-offseason .off-head .off-chip").strip()
    want = "Offseason Complete" if v["stage"] == "ready" else f"Stage {cur + 1} of {len(keys)}"
    assert want in chip, (chip, want)


def generic(page, label: str, combo: tuple) -> None:
    """The checks every page passes in every combo; a screenshot when SHOT_DIR is set."""
    name, width, theme = combo
    page.set_viewport_size({"width": width, "height": 900})
    page.evaluate("(t) => { document.documentElement.dataset.theme = t; }", theme)
    time.sleep(0.35)
    body = text(page)
    assert not BAD_WORDS.search(body), (label, name, BAD_WORDS.search(body).group(0))
    wide = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert wide <= 0, f"{label} {name}: the page scrolls sideways by {wide} px"
    bad = page.evaluate(TITLE_CHECK)
    assert not bad, (label, name, bad[:6])
    rows = page.evaluate(ROW_CHECK, GAP)
    assert not rows, (label, name, rows[:6])
    if width <= 400:
        short = page.evaluate("""() => [...document.querySelectorAll('#tab-offseason .off-page button, #tab-offseason .off-head button')]
            .filter((b) => b.offsetParent && !b.closest('.off-board') && b.getBoundingClientRect().height < 43.5).map((b) => b.textContent.trim().slice(0, 30))""")
        assert not short, (label, name, short[:5])
    if SHOT_DIR:
        page.screenshot(path=f"{SHOT_DIR}/{label}-{name}.png", full_page=True)


def every_combo(page, label: str) -> None:
    for c in COMBOS:
        generic(page, label, c)
    page.set_viewport_size({"width": 1280, "height": 900})
    page.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }")


def primary(page) -> str:
    return page.inner_text("#tab-offseason .off-foot .go-btn.primary").strip()


def click_primary(page) -> None:
    page.click("#tab-offseason .off-foot .go-btn.primary")


def back(page) -> None:
    page.click("#tab-offseason .off-foot .off-back")
    wait_page(page, "hub")


def check_hub(page, v: dict) -> None:
    t = text(page, "#tab-offseason .off-page")
    assert f"OFFSEASON · ON TO {v['year']}" in text(page, "#tab-offseason .off-head").upper()
    nums = text(page, "#tab-offseason .off-numbers")
    assert f"{v['roster']} / {v['roster_limit']}" in nums, nums
    assert str(v["signed"]) in nums and str(v["open_spots"]) in nums, nums
    assert f"{v['portal']['signed']} of {v['portal']['entrants']}" in nums, nums
    r = v.get("review")
    if r:
        meet = text(page, "#tab-offseason .off-review")
        assert r["goal"] in meet and f"{r['record'][0]}-{r['record'][1]}" in meet and r["mood"] in meet, meet
        assert f"{r['patience']} Years" in meet and f"{r['tenure']} in the Job" in meet, meet
        take = text(page, "#tab-offseason .off-takeaway")
        assert r["words"].split(".")[0] in take, take
        n = r["nil_portal"]
        assert f"{n['left']} left + {n['reward']} earned" in take, take
    assert primary(page).startswith("Advance to"), primary(page)
    assert "Sim to Next Season" in t


def check_departures(page, v: dict) -> None:
    mine = v["departures"]["mine"]
    card = text(page, "#tab-offseason .off-leaving")
    assert f"LEAVING YOUR PROGRAM · {len(mine)}" in card.upper(), card[:80]
    kinds = {}
    for d in mine:
        kinds.setdefault(d["kind_name"], []).append(d)
    for k, rows in kinds.items():
        assert f"{k} · {len(rows)}".upper() in card.upper(), (k, card[:200])
    stayed = v["departures"]["stayed"]                      # who you kept home: shown, never drafted
    if stayed:
        assert f"Stayed: You Kept Him Home · {len(stayed)}".upper() in card.upper(), card[:300]
        assert not {s["id"] for s in stayed} & {d["id"] for d in v["departures"]["first_round"]}
    best = max(mine, key=lambda d: d["overall"])
    assert best["name"] in card, best
    league = text(page, "#tab-offseason .off-league")
    lg = v["departures"]["league"]
    for k in ("graduated", "draft", "portal", "quit"):
        assert f"{lg.get(k, 0):,}" in league, (k, league)
    assert v["departures"]["first_round"][0]["name"] in text(page, "#tab-offseason .off-first")
    # "+ N more" opens the rest of a long group in place
    more = page.query_selector("#tab-offseason .off-leaving .off-more")
    if more:
        n = int(re.search(r"\d+", more.inner_text()).group(0))
        before = len(page.query_selector_all("#tab-offseason .off-leaving tbody tr"))
        more.click()
        page.wait_for_function("(n) => document.querySelectorAll('#tab-offseason .off-leaving tbody tr').length >= n", arg=before + n, timeout=10_000)
    assert page.query_selector("#tab-offseason .off-roster"), "the roster moves stay on Departures"


def check_retention(page, v: dict) -> None:
    r = v["retention"]
    strip = text(page, "#tab-offseason .off-keep-strip")
    assert str(len(r["players"])) in strip and f"{r['left']} / {r['budget']}" in strip and str(r["spent"]) in strip, strip
    assert "Players Want Out".upper() in strip.upper()
    cards = page.query_selector_all("#tab-offseason .off-keep .go-pcard")
    assert len(cards) == len(r["players"]), (len(cards), len(r["players"]))
    for c, e in zip(cards, r["players"]):
        t = c.inner_text()
        assert e["name"] in t and f"{e['overall']} OVR" in t and e["role_now_name"] in t and e["role_next_name"] in t, t
        assert "Why:" in t
        labels = [b.inner_text().strip() for b in c.query_selector_all(".off-keep-acts .go-act > b")]
        assert labels == ["Meet", "Promise a Start", "Offer NIL", "Let Him Go"], labels
        hints = [b.inner_text().strip() for b in c.query_selector_all(".off-keep-acts .go-act > span")]
        assert len(hints) == 4 and all(h.endswith(".") for h in hints), hints
        assert hints[1] == ("He would start." if e["role_next"] == "starter" else "He would not."), hints


def check_portal(page, v: dict) -> None:
    p = v["portal"]
    assert f"TRANSFER PORTAL · WEEK {p['week']} OF {p['weeks']}" in text(page, "#tab-offseason .off-head").upper()
    ov = text(page, "#tab-offseason .off-overview")
    assert f"{p['signed']} of {p['entrants']} have picked a school." in ov, ov
    assert f"You have {v['open_spots']} spots" in ov, ov
    kept = (v.get("retention") or {}).get("results") or []
    if kept and p["week"] == 1:
        ans = text(page, "#tab-offseason .off-answers")
        assert kept[0]["name"] in ans, ans
    page.wait_for_selector("#tab-offseason .off-board .go-meters", timeout=60_000)


def check_development(page, v: dict) -> None:
    nums = text(page, "#tab-offseason .off-dev-stats")
    assert f"{v['roster']} / {v['roster_limit']}" in nums, nums
    assert str(len(v["position_changes"])) in nums
    rs = v.get("redshirts")
    if rs:
        picked = sum(1 for p in rs["players"] if p["redshirt"])
        assert f"{picked} / {len(rs['players'])}" in nums, nums
    rec = v.get("portal_recap")
    if rec:
        side = text(page, "#tab-offseason .off-recap")
        assert f"+{len(rec['signed'])}" in side and f"−{len(rec['lost'])}" in side, side
    tabs = [t.inner_text().strip() for t in page.query_selector_all("#tab-offseason .off-tab")]
    assert tabs[0].startswith("Redshirts") and tabs[1].startswith("Position Changes") and tabs[2] == "Who Improved" and tabs[3].startswith("Your Transfers"), tabs
    page.click("#tab-offseason .off-tab >> nth=2")
    page.wait_for_selector("#tab-offseason .off-tabpanel[data-tab=improved]:not([hidden])", timeout=10_000)
    mine = v["report"]["mine"]
    if mine:
        assert mine[0]["name"] in text(page, "#tab-offseason .off-tabpanel[data-tab=improved]")
        top = text(page, "#tab-offseason .off-top")
        best = max(mine, key=lambda d: d["gain"])
        if best["gain"] > 0:
            assert best["name"] in top and f"+{best['gain']}" in top, top
    page.click("#tab-offseason .off-tab >> nth=0")
    page.wait_for_selector("#tab-offseason .off-tabpanel[data-tab=redshirts]:not([hidden])", timeout=10_000)


def check_ready(page, v: dict) -> None:
    assert "OFFSEASON RECAP" in text(page, "#tab-offseason .off-head").upper()
    keys = text(page, "#tab-offseason .off-results")
    assert f"Roster: {v['roster']} / {v['roster_limit']}" in keys and f"Class Signed: {v['signed']}" in keys, keys
    assert f"Departures: {len(v['departures']['mine'])}" in keys, keys
    rec = v.get("portal_recap")
    if rec:
        assert f"Transfer Portal: +{len(rec['signed'])} / −{len(rec['lost'])}" in keys, keys
    r = v.get("review") or {}
    if r.get("nil_next") is not None:
        assert f"Next Year's NIL: About {r['nil_next']}" in keys, keys
    road = text(page, "#tab-offseason .off-road")
    assert v["goal_next"] in road and f"{v['year']} Schedule" in road, road
    if v["history"]:                                       # a first season has no history until the next one starts
        assert str(v["history"][-1]["year"]) in text(page, "#tab-offseason .off-history")
    else:
        assert not page.query_selector("#tab-offseason .off-history")
    assert primary(page) == f"Start the {v['year']} Season", primary(page)


def run(base: str, sid: str, browser) -> None:
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("try { localStorage.setItem('cfp.theme', 'dark'); } catch (e) {}")
    page.goto(f"{base}/index.html?id={sid}")
    v = call(base, f"/api/season/{sid}/offseason")
    assert v["stage"] == "retention"                                  # Keep Them Home first, then Departures
    # the tab opens on the Overview
    wait_page(page, "hub")
    stepper_ok(page, v)
    check_hub(page, v)
    every_combo(page, "0-overview")
    assert primary(page) == "Advance to Keep Them Home", primary(page)
    click_primary(page)
    wait_page(page, "retention")
    stepper_ok(page, v)
    check_retention(page, v)
    every_combo(page, "1-keep-them-home")
    back(page)                                                        # Back: the Overview, the stage unchanged
    assert call(base, f"/api/season/{sid}/offseason")["stage"] == "retention"
    stepper_ok(page, v)
    click_primary(page)
    wait_page(page, "retention")
    page.reload()                                                     # a reload lands on the page it was on
    wait_page(page, "retention")
    if v["review"] and not v["review"]["decided"]:                    # the AD waits for an answer before the offseason moves on
        call(base, f"/api/season/{sid}/offseason/review", {"action": "nothing", "stage": "retention"})
        page.reload(); wait_page(page, "retention")
    assert primary(page) == "Advance to Departures", primary(page)
    click_primary(page)
    wait_page(page, "departures")
    v = call(base, f"/api/season/{sid}/offseason")
    assert v["stage"] == "departures"
    stepper_ok(page, v)
    check_departures(page, v)
    every_combo(page, "2-departures")
    back(page)
    stepper_ok(page, v)
    assert primary(page) == "Advance to Departures", primary(page)
    click_primary(page)
    wait_page(page, "departures")
    assert primary(page) == "Advance to Transfer Portal (Week 1)", primary(page)
    click_primary(page)
    v = call(base, f"/api/season/{sid}/offseason")
    for week in (1, 2, 3, 4):
        wait_page(page, "portal")
        page.wait_for_function("(w) => document.querySelector('#tab-offseason .off-head').textContent.toUpperCase().includes(`WEEK ${w} OF 4`)", arg=week, timeout=120_000)
        v = call(base, f"/api/season/{sid}/offseason")
        assert v["stage"] == f"portal_w{week}", v["stage"]
        stepper_ok(page, v)
        check_portal(page, v)
        if week in (1, 4):
            every_combo(page, f"3-portal-week-{week}")
        want = f"Advance to Transfer Portal (Week {week + 1})" if week < 4 else "Close the Portal and Advance"
        assert primary(page) == want, primary(page)
        if week == 1:
            back(page)
            click_primary(page)
            wait_page(page, "portal")
        click_primary(page)
    wait_page(page, "development")
    v = call(base, f"/api/season/{sid}/offseason")
    stepper_ok(page, v)
    check_development(page, v)
    every_combo(page, "4-development")
    back(page)
    click_primary(page)
    wait_page(page, "development")
    assert primary(page) == "Advance to Staff Changes", primary(page)
    click_primary(page)
    wait_page(page, "staff")
    v = call(base, f"/api/season/{sid}/offseason")
    stepper_ok(page, v)
    assert "YOUR STAFF" in text(page).upper()
    every_combo(page, "5-staff")
    assert primary(page) == "Finish the Offseason", primary(page)
    click_primary(page)
    wait_page(page, "ready")
    v = call(base, f"/api/season/{sid}/offseason")
    stepper_ok(page, v)
    check_ready(page, v)
    every_combo(page, "6-recap")
    assert not page.query_selector("#tab-offseason .off-foot .off-back"), "the recap has no Back: the offseason is done"
    assert not errors, errors
    page.close()


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("offseason redesign skipped: Playwright is not installed")
        raise SystemExit(0)
    from coach_career import league
    from sim import season
    from test_offseason import finished
    st = season.new_season("georgia", "full", seed=8, career=True)
    finished(st)
    season.save_season(st)
    sid = st["id"]
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
        if SHOT_DIR:
            Path(SHOT_DIR).mkdir(parents=True, exist_ok=True)
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"offseason redesign skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            run(base, sid, browser)
            browser.close()
        print("offseason redesign ok: every stage at 1280 and 400, light and dark; stepper, real numbers, Title Case, rows aligned, Back and Advance")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        league.forget(sid)
        server.terminate()
        server.wait(timeout=30)
