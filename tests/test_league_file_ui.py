"""The New Career screen's League panel (web/leaguefile.js) in a browser, at 1280 and 400 in light and dark:
"League: Built-in" by default; a file over the limit is refused with a toast before it is read (nothing posted);
an import with errors lists them as sentences and the select stays on the built-in league; an import that checks
shows the four stat chips, the summary lines and Start Career, the select names the file's league and the team
picker gains its teams in place; the page stays responsive through the whole check (busy, with a running count);
labels are Title Case, nothing scrolls sideways, no control row overflows, the controls sit inside the panel and are
44 px on a phone; the four chips share a row at 1280; the team cards follow the league (pruned on a switch).
Export League downloads the built-in league as valid `cfp-league/1` JSON; a check that throws toasts a sentence and
puts the panel back on the built-in league; a 20-line summary folds behind Show All N Lines, which patches in every
line; Who Coaches? keeps Create a New Coach for the built-in league and replaces it with a sentence for an import;
Start Career from the import opens a career at Alder Tech, and the save opened fresh shows the league's teams.
The JS MAX_LEAGUE_BYTES is checked against coach_career/league_file.py's.
Screenshots of the three states at each width and theme go to LEAGUE_SHOTS (default: a temporary folder).
Needs Playwright with a Chromium; without one it is skipped. Slow (each import fills ten rosters). (Run as a file.)"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch   # noqa: E402
from test_copy_case import bad_words   # noqa: E402

COMBOS = ((1280, 900, "light"), (1280, 900, "dark"), (400, 860, "light"), (400, 860, "dark"))
SHOTS = Path(os.environ.get("LEAGUE_SHOTS") or tempfile.mkdtemp(prefix="cfp-league-shots-"))
BIG_SKY_EAST = ["alder-tech", "basalt-state", "cascade-tech", "deschutes", "elk-river", "fir-valley",
                "glacier-state", "high-desert", "ironwood", "juniper-state"]
STATES = ["OR", "OR", "WA", "OR", "ID", "WA", "MT", "OR", "WA", "ID"]
NULLISH = re.compile(r"\b(null|undefined|NaN)\b")


def new_team(slug: str, state: str, **kw) -> dict:
    return {"slug": slug, "name": " ".join(w.capitalize() for w in slug.split("-")), "state": state, "conference": "big-sky-east", **kw}


def good_doc() -> dict:
    """Alder Tech in a new ten-team conference, Kent State removed."""
    return {"format": "cfp-league/1", "name": "My League",
            "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 8}],
            "teams": [new_team(s, st, **({"rivals": ["oregon-state"], "prestige": 40} if s == "alder-tech" else {}))
                      for s, st in zip(BIG_SKY_EAST, STATES)],
            "remove": ["kent-state"]}


def long_doc() -> dict:
    """Sixteen new teams in two new conferences: a summary of 20 lines, long enough to fold behind Show All."""
    west = ["coast-tech", "redwood-state", "harbor-state", "summit-tech", "pacific-plains", "shasta-state", "tidewater", "sierra-tech"]
    return {"format": "cfp-league/1", "name": "Long League",
            "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 7},
                            {"id": "pacific-west", "name": "Pacific West", "level": "FBS", "games": 7}],
            "teams": [new_team(s, "OR") for s in BIG_SKY_EAST[:8]] + [new_team(s, "CA", conference="pacific-west") for s in west]}


def js_max_league_bytes() -> int:
    """web/leaguefile.js's MAX_LEAGUE_BYTES, as written there (`<n> * MB`, MB = 1024 * 1024)."""
    src = (ROOT / "web" / "leaguefile.js").read_text(encoding="utf-8")
    assert re.search(r"const MB = 1024 \* 1024;", src), "MB is 1024 * 1024"
    m = re.search(r"const MAX_LEAGUE_BYTES = (\d+) \* MB;", src)
    assert m, "web/leaguefile.js states MAX_LEAGUE_BYTES as <n> * MB"
    return int(m.group(1)) * 1024 * 1024


def bad_doc() -> dict:
    """A bad position, a depth-chart typo, and a team both removed and listed."""
    doc = good_doc()
    doc["teams"][0]["roster"] = [{"name": "Jay Smith", "pos": "WRR", "class": "FR"}]
    doc["teams"].append({"slug": "kent-state", "name": "Kent State", "conference": "mac"})
    doc["teams"].append({"slug": "rice", "name": "Rice", "depth_chart": {"QB": ["Nobody Here"]}})
    return doc


def many_doc() -> dict:
    """100 new teams in a conference that is nowhere: 100 problems; the server lists 50 and "And 50 more."."""
    return {"format": "cfp-league/1", "teams": [{"slug": f"bad-{i}", "name": f"Bad {i}", "conference": "nowhere"} for i in range(100)]}


def check_many(page, many: Path) -> None:
    """The head counts every problem the file has, not the capped list's lines."""
    page.set_input_files("#league-file", str(many))
    page.wait_for_function("() => (document.querySelector('#league-result .league-error-head') || {}).textContent?.includes('100 problems')",
                           timeout=60_000)
    errs = page.eval_on_selector_all("#league-result .league-errors li", "els => els.map(e => e.textContent)")
    assert errs[-1] == "And 50 more.", errs[-3:]


def title_case(label: str) -> bool:
    return not bad_words(label)


def check_builtin(page, width) -> None:
    page.wait_for_selector("#league-panel #pick-league")
    assert page.input_value("#pick-league") == "builtin", "the built-in league is the default"
    opts = page.eval_on_selector_all("#pick-league option", "os => os.map(o => [o.value, o.textContent])")
    assert opts == [["builtin", "League: Built-in"], ["import", "Import League File…"]], opts
    assert page.evaluate("() => window.LeagueFile.key()") == "builtin"
    assert page.evaluate("() => window.LeagueFile.teams()") is None
    assert page.inner_text("#btn-export-league").strip() == "Export League"
    assert page.eval_on_selector("#league-panel h2", "e => e.textContent") == "League"
    assert page.eval_on_selector("#league-file", "e => e.hidden && e.accept") == ".json,application/json"


def check_layout(page, width, state: str) -> None:
    """No sideways scroll, no control row overflowing its box, every control inside the panel, Title Case labels,
    nothing null on the page, and 44 px controls on a phone. Boxes are compared with each other and the viewport."""
    assert page.evaluate("() => document.documentElement.scrollWidth <= document.documentElement.clientWidth"), f"{state}: sideways scroll"
    over = page.evaluate("""() => [...document.querySelectorAll('#league-panel, #league-panel *')]
        .filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1 && !['SELECT', 'OPTION'].includes(e.tagName)
                     && getComputedStyle(e).overflowX !== 'visible')
        .map(e => e.id || e.className)""")
    assert not over, f"{state}: a box in the panel scrolls sideways: {over}"
    assert page.evaluate("""() => { const p = document.querySelector('#league-panel').getBoundingClientRect();
        return p.left >= 0 && p.right <= document.documentElement.clientWidth + 1
          && [...document.querySelectorAll('#league-panel button, #league-panel select, #league-panel .go-chip')].filter(e => e.getClientRects().length)
               .every(e => { const r = e.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1; }); }"""), \
        f"{state}: a control sits outside the panel"
    labels = page.evaluate("""() => [
        ...[...document.querySelectorAll('#pick-league option')].map(o => o.textContent),
        ...[...document.querySelectorAll('#league-panel button:not(.go-info)')].map(b => b.textContent.trim()),
        ...[...document.querySelectorAll('#league-result .go-chip .league-stat-k')].map(b => b.textContent.trim()),
        document.querySelector('#league-panel h2').textContent]""")
    bad = [x for x in labels if not title_case(x)]
    assert not bad, f"{state}: labels not in Title Case: {bad}"
    body = page.inner_text("body")
    assert not NULLISH.search(body), f"{state}: null on the page"
    from sim import fcs_names
    assert not fcs_names.has_old(body), f"{state}: an old FCS stand-in name on the page"
    if width == 400:
        for sel in ("#pick-league", "#btn-export-league", "#btn-league-start"):
            if page.query_selector(sel):
                h = page.eval_on_selector(sel, "e => e.getBoundingClientRect().height")
                assert h >= 44, f"{state}: {sel} is {h} px tall on a phone"
        # the panel stacks: the select and Export League each take the row
        boxes = page.evaluate("() => ['#pick-league', '#btn-export-league'].map(s => document.querySelector(s).getBoundingClientRect().top)")
        assert boxes[1] > boxes[0], f"{state}: the controls stack on a phone"


def check_too_big(page, big: Path, posted: list) -> None:
    n = len(posted)
    page.set_input_files("#league-file", str(big))
    page.wait_for_function("(t) => [...document.querySelectorAll('#toasts .toast-item')].some(e => e.textContent.trim() === t)",
                           arg="The file is 65.0 MB; the game reads league files up to 64 MB.", timeout=10_000)
    time.sleep(0.3)
    assert len(posted) == n, "a file over the limit is never posted"
    assert page.input_value("#pick-league") == "builtin"
    assert not page.query_selector("#league-result .league-errors, #league-result .go-chip")


def check_errors(page, bad: Path, tag: str) -> None:
    page.set_input_files("#league-file", str(bad))
    page.wait_for_selector("#league-result .league-errors li", timeout=60_000)
    errs = page.eval_on_selector_all("#league-result .league-errors li", "els => els.map(e => e.textContent)")
    assert "Alder Tech, player 1 (Jay Smith): position 'WRR' is not a position; use QB, RB, WR, TE, LT, LG, C, RG, RT, LEDG, DT, REDG, SAM, MIKE, WILL, CB, FS, SS, K, P or FB." in errs, errs
    assert "Kent State: the file removes it and also lists it; do one or the other." in errs, errs
    assert "Rice: the depth chart's QB list names Nobody Here, who is not on the roster." in errs, errs
    assert all(e[0].isupper() and e.endswith(".") for e in errs), errs
    assert page.input_value("#pick-league") == "builtin"
    assert page.evaluate("() => window.LeagueFile.key()") == "builtin"
    assert not page.query_selector("#btn-league-start")
    head = page.inner_text("#league-result .league-error-head").strip()
    assert head[0].isupper() and head.endswith("."), head


def check_good(page, good: Path, tag: str, width: int = 1280) -> None:
    """An import that checks: busy (and responsive) the whole check, then the chips, the lines and Start Career."""
    t0 = time.time()
    page.set_input_files("#league-file", str(good))
    page.wait_for_selector("#league-result .league-busy", timeout=10_000)
    # the page answers while the game checks: a frame comes within a second, and the running count moves
    lags = []
    for _ in range(3):
        a = time.time()
        page.evaluate("() => new Promise(r => requestAnimationFrame(() => r(1)))")
        lags.append(time.time() - a)
        assert page.query_selector("#league-result .league-busy") or page.query_selector("#btn-league-start"), "busy until the check lands"
        time.sleep(0.4)
    assert max(lags) < 1.0, f"the page froze during the check: {lags}"
    if page.query_selector("#league-result .league-busy"):
        assert page.eval_on_selector("#pick-league", "e => e.disabled && e.getAttribute('aria-busy') === 'true'"), "the select is busy"
        assert page.eval_on_selector("#btn-export-league", "e => e.disabled"), "Export waits for the check"
        line = page.inner_text("#league-result .league-busy p")
        assert line.startswith("Checking good.json") and line.rstrip().endswith("."), line
    page.wait_for_selector("#btn-league-start", timeout=180_000)
    print(f"  {tag}: checked in {time.time() - t0:.1f} s")
    chips = page.eval_on_selector_all("#league-result .go-chip", "els => els.map(e => e.textContent.trim())")
    assert len(chips) == 4 and chips[0].startswith("Teams Added") and "Players Generated" in chips[3], chips
    assert [re.sub(r"\s+", " ", c) for c in chips] == ["Teams Added 10", "Teams Changed 0", "Teams Removed 1", "Players Generated 850"], chips
    lines = page.eval_on_selector_all("#league-result p.league-line", "els => els.map(e => e.textContent)")
    assert lines and all(x[0].isupper() and x.endswith(".") for x in lines), lines
    assert "Generated 850 players in all." in lines, lines
    assert page.input_value("#pick-league") == "file"
    assert page.eval_on_selector("#pick-league option[value=file]", "o => o.textContent") == "League: My League"
    assert page.inner_text("#btn-league-start").strip() == "Start Career"
    assert page.eval_on_selector("#pick-team", "s => [...s.options].some(o => o.value === 'alder-tech')")
    assert not page.eval_on_selector("#pick-team", "s => [...s.options].some(o => o.value === 'kent-state')"), "a removed team leaves the picker"
    assert page.evaluate("() => window.LeagueFile.key()") not in ("builtin", None)
    assert page.evaluate("() => window.LeagueFile.teams().some(t => t.slug === 'alder-tech')")
    # the cards follow the league: the removed team's card is pruned, the added team's is there, the stand-ins stay
    assert page.evaluate("() => !window.CFP.teamsBySlug['kent-state'] && window.CFP.teamsBySlug['alder-tech'].name === 'Alder Tech'"), "the cards follow the import"
    assert page.evaluate("() => Object.values(window.CFP.teamsBySlug).some(t => t.fictional)"), "the FCS stand-ins' cards stay"
    if width == 1280:     # the four chips on one row: their tops against each other, never a pixel width
        tops = page.eval_on_selector_all("#league-result .go-chip", "els => els.map(e => Math.round(e.getBoundingClientRect().top))")
        assert max(tops) - min(tops) <= 1, f"{tag}: the four chips sit on one row at 1280: {tops}"


def check_back_to_builtin(page) -> None:
    """League: Built-in puts the game's teams back in the picker, in place."""
    keep = page.evaluate("() => { const o = document.querySelector('#pick-team option[value=ohio-state]'); o.__mark = 1; return 1; }")
    assert keep
    page.select_option("#pick-league", "builtin")
    page.wait_for_function("() => !document.querySelector('#pick-league option[value=file]') && !document.querySelector('#btn-league-start')")
    assert page.evaluate("() => window.LeagueFile.key()") == "builtin"
    assert page.eval_on_selector("#pick-team", "s => [...s.options].some(o => o.value === 'kent-state') && ![...s.options].some(o => o.value === 'alder-tech')")
    assert page.evaluate("() => document.querySelector('#pick-team option[value=ohio-state]').__mark === 1"), "the picker is patched, not rebuilt"
    assert page.evaluate("() => window.CFP.teamsBySlug['kent-state'] && !window.CFP.teamsBySlug['alder-tech']"), "the built-in cards come back, pruned"
    # the built-in league keeps Who Coaches?'s Create a New Coach link
    page.click("#btn-new")
    page.wait_for_selector(".modal:not([hidden]) .start-card", timeout=30_000)
    assert page.query_selector(".modal:not([hidden]) a[href*='coach.html']"), "the built-in league keeps Create a New Coach"
    assert not page.query_selector(".modal:not([hidden]) .start-coach-note")
    page.click("#modal-close")
    page.wait_for_selector("#modal", state="hidden")


def check_thrown(page, good: Path) -> None:
    """A check that throws (the game unreachable): a toast in a sentence, and the panel back on the built-in league,
    so the select, the picker and New Season agree."""
    assert page.input_value("#pick-league") == "file"
    page.route("**/api/league/check", lambda r: r.fulfill(status=500, content_type="application/json", body='{"detail":"disk full"}'))
    try:
        page.set_input_files("#league-file", str(good))
        page.wait_for_function("(t) => [...document.querySelectorAll('#toasts .toast-item')].some(e => e.textContent.trim() === t)",
                               arg="Could not check good.json: Disk full.", timeout=30_000)
    finally:
        page.unroute("**/api/league/check")
    page.wait_for_function("() => !document.querySelector('#league-result .league-busy')")
    assert page.input_value("#pick-league") == "builtin" and not page.query_selector("#pick-league option[value=file]")
    assert page.evaluate("() => window.LeagueFile.key()") == "builtin"
    assert not page.query_selector("#btn-league-start")
    assert page.eval_on_selector("#pick-team", "s => [...s.options].some(o => o.value === 'kent-state')"), "the picker is back on the built-in teams"


def check_long(page, long_file: Path, width: int, tag: str) -> None:
    """A summary of 20 lines folds its team lines behind Show All N Lines (Title Case, 44 px on a phone), which
    patches in every line."""
    page.set_input_files("#league-file", str(long_file))
    page.wait_for_selector("#league-result .league-actions button:not(#btn-league-start)", timeout=180_000)
    more = page.query_selector("#league-result .league-actions button:not(#btn-league-start)")
    label = more.inner_text().strip()
    assert label == "Show All 20 Lines" and title_case(label), label
    if width == 400:
        assert more.bounding_box()["height"] >= 44, "Show All is 44 px on a phone"
    shown = page.eval_on_selector_all("#league-result p.league-line", "els => els.map(e => e.textContent)")
    assert len(shown) == 12 and shown[-2].startswith("Generated ") and shown[-2].endswith(" players in all."), shown
    assert shown[-1] == "The 2026 schedule is built from the file's conferences.", shown
    start = page.query_selector("#btn-league-start")
    more.click()
    page.wait_for_function("() => document.querySelectorAll('#league-result p.league-line').length === 20")
    assert not page.query_selector("#league-result .league-actions button:not(#btn-league-start)"), "Show All goes once every line shows"
    assert page.evaluate("(a) => a === document.querySelector('#btn-league-start')", start), "Start Career is patched in place, not redrawn"
    check_layout(page, width, f"{tag} long summary")
    page.screenshot(path=str(SHOTS / f"league-{tag}-long.png"), full_page=True)


def check_export(page) -> None:
    with page.expect_download(timeout=120_000) as d:
        page.click("#btn-export-league")
    dl = d.value
    assert dl.suggested_filename == "league.json", dl.suggested_filename
    doc = json.loads(Path(dl.path()).read_text(encoding="utf-8"))
    assert doc["format"] == "cfp-league/1" and len(doc["teams"]) == 138, (doc.get("format"), len(doc.get("teams", [])))
    page.wait_for_function("() => !document.querySelector('#btn-export-league').disabled")


def check_start(page, base) -> str:
    page.select_option("#pick-team", "alder-tech")
    page.click("#btn-league-start")
    page.wait_for_selector(".modal:not([hidden]) .start-card button.accent", timeout=30_000)
    title = page.inner_text("#modal-title")
    assert "Alder Tech" in title, title
    note = page.inner_text(".modal:not([hidden]) .start-coach-note").strip()
    assert note == "Create your coach on Your Coach before importing a league file; an imported league stays loaded only on this page.", note
    assert not page.query_selector(".modal:not([hidden]) a[href*='coach.html']"), "no link that would lose the imported league"
    btn = page.query_selector(".modal:not([hidden]) .start-card button.accent")
    assert btn.inner_text().startswith("Start As"), btn.inner_text()
    btn.click()
    page.wait_for_selector("#season:not([hidden])", timeout=180_000)
    page.wait_for_function("() => document.querySelector('#chip-name').textContent === 'Alder Tech'", timeout=30_000)
    assert page.evaluate("() => window.CFP.teamsBySlug['alder-tech'].name") == "Alder Tech"
    sid = re.search(r"[?&]id=([^&]+)", page.url).group(1)
    s = call(base, f"/api/season/{sid}")
    assert s["team"] == "alder-tech" and s["league"] == "My League", (s["team"], s["league"])
    assert page.evaluate("() => window.LeagueFile.key()") == "builtin", "the league is used up once the career starts"
    return sid


def check_reopen(browser, base, sid) -> None:
    """The save opened in a fresh page: the league's cards come from /api/season/{id}/teams before it draws."""
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#season:not([hidden])", timeout=60_000)
    page.wait_for_function("() => document.querySelector('#chip-name').textContent === 'Alder Tech'", timeout=30_000)
    assert page.evaluate("() => window.CFP.teamsBySlug['alder-tech'] && window.CFP.teamsBySlug['alder-tech'].conference") == "Big Sky East"
    assert not errors, errors
    page.close()


def run(browser, base, files) -> None:
    sid = None
    try:
        for i, (w, h, scheme) in enumerate(COMBOS):
            tag = f"{w}-{scheme}"
            ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, accept_downloads=True)
            page = ctx.new_page()
            errors, posted = [], []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("request", lambda r: posted.append(r.url) if "/api/league/check" in r.url else None)
            page.goto(f"{base}/index.html")
            check_builtin(page, w)
            check_layout(page, w, f"{tag} built-in")
            page.screenshot(path=str(SHOTS / f"league-{tag}-builtin.png"), full_page=True)
            check_too_big(page, files["big"], posted)
            check_errors(page, files["bad"], tag)
            if i == 0:
                check_many(page, files["many"])
            check_layout(page, w, f"{tag} errors")
            page.screenshot(path=str(SHOTS / f"league-{tag}-errors.png"), full_page=True)
            check_good(page, files["good"], tag, w)
            check_layout(page, w, f"{tag} summary")
            page.screenshot(path=str(SHOTS / f"league-{tag}-summary.png"), full_page=True)
            if i == 0:
                check_export(page)
                check_back_to_builtin(page)
                check_good(page, files["good"], tag, w)
                check_thrown(page, files["good"])
            if i == 2:
                check_long(page, files["long"], w, tag)
                check_good(page, files["good"], tag, w)
            if i == len(COMBOS) - 1:
                sid = check_start(page, base)
                check_reopen(browser, base, sid)
            assert not errors, errors
            ctx.close()
            print(f"  {tag} ok")
    finally:
        if sid:
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001 - the cleanup below still runs
                pass
            for f in (ROOT / "data" / "leagues").glob(f"{sid}*"):
                f.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("league file ui skipped: Playwright is not installed")
        raise SystemExit(0)
    from coach_career import league_file
    assert js_max_league_bytes() == league_file.MAX_LEAGUE_BYTES, "web/leaguefile.js's limit is the game's"
    tmp = Path(tempfile.mkdtemp(prefix="cfp-league-ui-"))
    files = {"good": tmp / "good.json", "bad": tmp / "bad.json", "big": tmp / "huge.json", "long": tmp / "long.json", "many": tmp / "many.json"}
    files["many"].write_bytes(league_file.dumps(many_doc()))
    files["long"].write_bytes(league_file.dumps(long_doc()))
    files["good"].write_bytes(league_file.dumps(good_doc()))
    files["bad"].write_bytes(league_file.dumps(bad_doc()))
    with open(files["big"], "wb") as f:     # sparse: 65 MB on paper, nothing on disk
        f.truncate(65 * 1024 * 1024)
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
                print(f"league file ui skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            run(browser, base, files)
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)
        for f in files.values():
            f.unlink(missing_ok=True)
        tmp.rmdir()
    print(f"league file ui ok (screenshots in {SHOTS})")
