"""An official visit's pill shows that week's game (web/recruiting.js visitPill, coach_career/prospects.visit_view), in a
browser at 1280 and 400 px, light and dark. A recruit committed elsewhere has his official visit with you in a played
week and one at another school in a played week; a second recruit has a visit booked for a week still to come. Checks:
- The API: each visit carries the visited school's game that week (week, opponent, venue, played, won, score, overtime),
  read-only (the stored visit is untouched), the opponent as the game shows it.
- The board pane's Snapshot tag ("Visited") and the Recruiting Battle's marks (yours and the other school's) show the
  result on hover, keyboard focus and tap, in the game's result line ("Week 4: W 56–10 vs Kent State"), matching the API's
  game; another school's reads "Penn State, Week 4: …". The tip sits inside the window.
- A visit not played yet reads as a sentence: "His official visit is Week 5, vs Illinois."
- The Prospect Profile popup draws the same tips.
- Pill labels stay Title Case; no null/undefined/NaN; no sideways scroll; at 400 px each tip pill stands 44 px tall.
Needs Playwright with a Chromium; skipped without one. VISIT_TIP_SHOTS=<folder> saves screenshots of the tips."""
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
from test_scene_window import wait_server   # noqa: E402

SHOTS = os.environ.get("VISIT_TIP_SHOTS")
ME, HOLDER, OTHER = "ohio-state", "michigan", "penn-state"
RESULT = re.compile(r"^(?:(?P<school>[A-Z][^,]*), )?Week (?P<week>\d+): (?P<wl>[WL]) (?P<pf>\d+)–(?P<pa>\d+)(?P<ot> OT)? (?P<vs>vs|at) (?P<opp>.+)$")
SENTENCE = re.compile(r"^His official visit(?: to (?P<school>[A-Z][^,]*))? is Week (?P<week>\d+), (?P<vs>vs|at) (?P<opp>.+)\.$")


def home_weeks(st, slug, played):
    return sorted(g["week"] for g in st["games"].values() if g["home"] == slug and g["kind"] == "regular" and bool(g["played"]) == played
                  and not g.get("neutral"))


def make_career():
    """A season four weeks in: recruit A committed to Michigan, with a played official visit at Ohio State and one at
    Penn State; recruit B with an Ohio State visit still to come. Both on the board."""
    from coach_career import persona
    from sim import season
    st = season.new_season(ME, "full", seed=13, career=True)
    season.advance_to(st, 4)
    rc = st["recruiting"]
    mine, theirs, ahead = home_weeks(st, ME, True), home_weeks(st, OTHER, True), home_weeks(st, ME, False)
    assert mine and theirs and ahead, (mine, theirs, ahead)
    taken = lambda q: q in rc["visits"] or rc["status"][q]["committed"] or rc["status"][q]["signed"] or rc["prospects"][q].get("hidden")
    order = [q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]) if not taken(q)]
    a = next(q for q in order if not persona.is_quiet(st, q))      # a Quiet Commit would hide where he committed
    b = next(q for q in order if q != a)
    rc["status"][a].update(committed=HOLDER, fcs=False, firmness=60, hard=False)
    for slug, pts in ((ME, 900.0), (OTHER, 800.0), (HOLDER, 1000.0)):
        rc["lists"][a][slug] = rc["lists"][a].get(slug, 0.0) + pts
        rc["offers"].setdefault(slug, [])
        if a not in rc["offers"][slug]:
            rc["offers"][slug].append(a)
    rc["visits"][a] = {ME: {"week": mine[-1], "done": True}, OTHER: {"week": theirs[-1], "done": True}}
    rc["lists"][b][ME] = rc["lists"][b].get(ME, 0.0) + 900.0
    rc["visits"][b] = {ME: {"week": ahead[0], "done": False}}
    rc["board"] = [a, b]
    season.save_season(st)
    game = lambda slug, w: next(g for g in st["games"].values() if g["week"] == w and slug in (g["home"], g["away"]))
    return st["id"], {"a": a, "b": b}, {"mine": game(ME, mine[-1]), "theirs": game(OTHER, theirs[-1]), "ahead": game(ME, ahead[0])}


def check_api(base, sid, ids, games) -> dict:
    """The board row's visit and the profile's list carry each school's game, matching the season's games."""
    from sim import season
    teams = season.load_teams()
    row = call(base, f"/api/season/{sid}/prospect/{ids['a']}")
    v = row["row"]["visit"]
    g = games["mine"]
    assert set(v) == {"week", "done", "game"} and v["done"] is True, v
    want = {"week": g["week"], "opponent_name": season.team_display(g["away"], teams), "venue": "home", "played": True,
            "won": g["home_score"] > g["away_score"], "points_for": g["home_score"], "points_against": g["away_score"], "overtime": g.get("overtime") or 0}
    assert v["game"] == want, (v["game"], want)
    other = next(x for x in row["public"]["schools"] if x["school"] == OTHER)["visit"]["game"]
    t = games["theirs"]
    assert other["points_for"] == t["home_score"] and other["points_against"] == t["away_score"] and other["opponent_name"] == season.team_display(t["away"], teams), other
    nb = call(base, f"/api/season/{sid}/prospect/{ids['b']}")["row"]["visit"]
    assert nb["done"] is False and nb["game"]["played"] is False and nb["game"]["points_for"] is None and nb["game"]["won"] is None, nb
    assert nb["game"]["opponent_name"] == season.team_display(games["ahead"]["away"], teams), nb
    stored = season.load_season(sid)["recruiting"]["visits"][ids["a"]][ME]
    assert set(stored) == {"week", "done"}, f"the stored visit is untouched: {stored}"
    return {"mine": v["game"], "other": other, "ahead": nb["game"], "other_name": teams[OTHER]["name"]}


def expect_result(text: str, g: dict, school=None, where="") -> None:
    m = RESULT.match(text)
    assert m, f"a result line: {text!r} {where}"
    assert int(m["week"]) == g["week"] and m["wl"] == ("W" if g["won"] else "L") and int(m["pf"]) == g["points_for"] and int(m["pa"]) == g["points_against"], (text, g, where)
    assert m["opp"] == g["opponent_name"] and m["vs"] == ("at" if g["venue"] == "away" else "vs") and bool(m["ot"]) == bool(g["overtime"]), (text, g, where)
    assert m["school"] == school, (text, school, where)
    for bad in ("null", "undefined", "NaN"):
        assert bad not in text, (text, where)


def expect_sentence(text: str, g: dict, where="") -> None:
    m = SENTENCE.match(text)
    assert m, f"a sentence: {text!r} {where}"
    assert int(m["week"]) == g["week"] and m["opp"] == g["opponent_name"] and m["vs"] == "vs" and not m["school"], (text, g, where)


TIP_JS = """(cell) => { const t = cell.querySelector(':scope > .go-tip-box'); const r = t.getBoundingClientRect(), c = cell.getBoundingClientRect();
  return { show: t.classList.contains('show'), text: t.textContent, l: r.left, r: r.right, t: r.top, b: r.bottom, vw: document.documentElement.clientWidth,
           vh: document.documentElement.clientHeight, h: c.height, label: cell.firstElementChild.textContent,
           described: cell.getAttribute('aria-describedby') === t.id }; }"""


def tip_of(page, sel: str, how: str, where: str) -> dict:
    page.evaluate("""() => { if (window.__vlog) return; window.__vlog = []; for (const k of ['pointerdown', 'mouseover', 'mouseout', 'focusin', 'focusout', 'click'])
      document.addEventListener(k, (e) => window.__vlog.push(k + ':' + (e.target.className || e.target.tagName)), true); }""")
    page.mouse.move(2, 2)
    page.evaluate("() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); document.querySelectorAll('.go-tip-box.show').forEach(t => t.classList.remove('show')); }")
    page.wait_for_selector(sel, state="visible", timeout=30_000)
    page.eval_on_selector(sel, "e => e.scrollIntoView({ block: 'center' })")
    time.sleep(0.2)
    if how == "hover":
        page.hover(sel)
    elif how == "focus":
        page.focus(sel)
    else:
        page.tap(sel)
    try:
        page.wait_for_function("(s) => { const c = document.querySelector(s); const t = c && c.querySelector(':scope > .go-tip-box'); return t && t.classList.contains('show'); }",
                               arg=sel, timeout=3_000)
    except Exception:  # noqa: BLE001
        pass
    t = page.eval_on_selector(sel, TIP_JS)
    assert t["show"], f"the visit tip shows on {how} {where}: {sel} {page.evaluate('() => window.__vlog.slice(-12)')}"
    assert t["described"], f"the pill is described by its tip {where}"
    assert t["l"] >= 0 and t["r"] <= t["vw"] + 0.5 and t["t"] >= 0 and t["b"] <= t["vh"] + 0.5, f"the tip stays in the window {where}: {t}"
    assert t["label"] in ("Visited",) or re.fullmatch(r"Visit Wk \d+", t["label"]), f"a Title Case pill label {where}: {t['label']!r}"
    return t


def no_sideways(page, where: str) -> None:
    over = page.evaluate("() => ({ page: document.documentElement.scrollWidth - innerWidth, pane: (() => { const b = document.querySelector('.go-pane'); return b ? b.scrollWidth - b.clientWidth : 0; })() })")
    assert over["page"] <= 0 and over["pane"] <= 0, f"no sideways scroll {where}: {over}"


def shot(page, name: str) -> None:
    if SHOTS:
        Path(SHOTS).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(Path(SHOTS) / f"visit-tip-{name}.png"), full_page=False)


def open_pane(page, base, sid, pid) -> None:
    page.goto(f"{base}/index.html?id={sid}&tab=recruiting&pid={pid}")
    page.wait_for_selector(".go-pane .pv-hero", timeout=120_000)
    page.wait_for_function("() => document.querySelectorAll('.go-pane .pv-grid > .pv-card').length >= 2 && !document.querySelector('.go-pane .go-loading')", timeout=60_000)
    time.sleep(0.4)


SNAP = ".go-pane [data-key=snapshot] .go-visit-tip"
MINE = f".go-pane .pv-rival[data-school={ME}] .go-visit-tip"
THEIRS = f".go-pane .pv-rival[data-school={OTHER}] .go-visit-tip"


def run(browser, base, sid, ids, api, width, scheme, errs) -> None:
    phone = width < 760
    ctx = browser.new_context(viewport={"width": width, "height": 860}, color_scheme=scheme, **({"has_touch": True, "is_mobile": True} if phone else {}))
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    where = f"at {width} {scheme}"
    if phone:
        page.goto(f"{base}/index.html?id={sid}&tab=recruiting")
        page.wait_for_selector(".go-row-recruit", timeout=120_000)
        page.click(f".go-row-recruit[data-pid='{ids['a']}']")
        page.wait_for_selector(".go-pane.sheet .pv-hero", timeout=30_000)
        page.wait_for_function("() => document.querySelectorAll('.go-pane .pv-grid > .pv-card').length >= 2 && !document.querySelector('.go-pane .go-loading')", timeout=60_000)
        time.sleep(0.4)
    else:
        open_pane(page, base, sid, ids["a"])
    hows = ("tap", "focus") if phone else ("hover", "focus")
    for how in hows:
        t = tip_of(page, SNAP, how, f"(Snapshot) {where}")
        expect_result(t["text"], api["mine"], None, f"(Snapshot) {where}")
        if how == hows[0]:
            shot(page, f"{width}-{scheme}")
        t = tip_of(page, MINE, how, f"(Battle, yours) {where}")
        expect_result(t["text"], api["mine"], None, f"(Battle, yours) {where}")
        t = tip_of(page, THEIRS, how, f"(Battle, theirs) {where}")
        expect_result(t["text"], api["other"], api["other_name"], f"(Battle, theirs) {where}")
        if phone:
            assert t["h"] >= 44 - 0.5, f"a tip pill is 44 px tall on a phone {where}: {t['h']}"
    if phone:
        small = page.evaluate("() => [...document.querySelectorAll('.go-pane .go-tip')].filter(e => e.getClientRects().length).map(e => Math.round(e.getBoundingClientRect().height)).filter(h => h < 44)")
        assert not small, f"every tip cell in the pane is 44 px tall {where}: {small}"
    page.keyboard.press("Escape") if not phone else None
    text = page.inner_text(".go-pane")
    assert not re.search(r"\b(null|undefined|NaN)\b", text), f"no null/undefined/NaN {where}"
    no_sideways(page, where)
    # the visit still to come: a sentence
    if phone:
        page.goto(f"{base}/index.html?id={sid}&tab=recruiting")
        page.wait_for_selector(".go-row-recruit", timeout=120_000)
        page.click(f".go-row-recruit[data-pid='{ids['b']}']")
        page.wait_for_selector(".go-pane.sheet .pv-hero", timeout=30_000)
        time.sleep(0.6)
    else:
        open_pane(page, base, sid, ids["b"])
    t = tip_of(page, SNAP, hows[0], f"(unplayed) {where}")
    assert re.fullmatch(r"Visit Wk \d+", t["label"]) and int(t["label"].split()[-1]) == api["ahead"]["week"], t["label"]
    expect_sentence(t["text"], api["ahead"], f"(unplayed) {where}")
    shot(page, f"{width}-{scheme}-unplayed")
    no_sideways(page, f"(unplayed) {where}")
    # the Prospect Profile popup: the same tips
    if not phone:
        page.goto(f"{base}/index.html?id={sid}&tab=recruiting&modal=profile:{ids['a']}")
        m = ".modal:not([hidden]) .pv-popup"
        page.wait_for_selector(f"{m} .pv-hero", timeout=120_000)
        page.wait_for_function("(m) => document.querySelectorAll(m + ' .pv-grid > .pv-card').length >= 2 && !document.querySelector(m + ' .go-loading')", arg=m, timeout=60_000)
        time.sleep(0.4)
        t = tip_of(page, f"{m} [data-key=snapshot] .go-visit-tip", "hover", f"(popup) {where}")
        expect_result(t["text"], api["mine"], None, f"(popup) {where}")
        t = tip_of(page, f"{m} .pv-rival[data-school={OTHER}] .go-visit-tip", "hover", f"(popup, theirs) {where}")
        expect_result(t["text"], api["other"], api["other_name"], f"(popup, theirs) {where}")
        shot(page, f"{width}-{scheme}-popup")
    ctx.close()


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("visit result tip skipped: Playwright is not installed")
        raise SystemExit(0)
    sid, ids, games = make_career()
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    errs = []
    try:
        wait_server(base)
        api = check_api(base, sid, ids, games)
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"visit result tip skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            for scheme in ("light", "dark"):
                for width in (1280, 400):
                    run(browser, base, sid, ids, api, width, scheme, errs)
            browser.close()
        assert not errs, errs
        print("visit result tip ok: the visit pills show the week's game (its result once played, the week and opponent before), at 1280 and 400, light and dark")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
