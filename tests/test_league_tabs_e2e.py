"""A career from a league file, every tab in a browser (the brief's Task 10): the league of
tests/test_league_readers.py (Alder Tech in the new Big Sky East, Kent State removed, the MAC renamed
"Lake Erie League") imported on the New Career screen and started as Alder Tech; then every season tab at
1280x900 and 400x860, every offseason stage reached by advancing (both widths), and every tab again in 2027,
the 1280 page carried there in place (no reload). On each: no console error and no failed request, Alder
Tech in the header, its conference on Standings, nothing null, undefined or NaN, no Kent State, no "MAC",
no old FCS stand-in name, no sideways scroll. Needs Playwright with a Chromium; without one it is skipped.
Slow (an import, a season faked to its end, an offseason). (Run as a file.)"""
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

from test_career_e2e import call, free_port, launch, tab_click   # noqa: E402
from test_league_readers import NEW_CONF, RENAMED, fixture   # noqa: E402

WIDTHS = ((1280, 900), (400, 860))
NULLISH = re.compile(r"\b(null|undefined|NaN)\b")
OLD_MAC = re.compile(r"\bMAC\b")


def start_server(port: int) -> subprocess.Popen:
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(120):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/teams", timeout=2)
            return server
        except OSError:
            time.sleep(0.5)
    raise RuntimeError("the dev server did not start")


IN_FLIGHT: dict = {}     # page -> its API calls not yet answered (watched counts them, quiet waits on them)


def dev_only(url: str) -> bool:
    """version.json is written by the site build (tools/build_site.py), not served by the dev server."""
    return url.endswith("/version.json")


def watched(ctx_page, problems: list):
    """Record console errors, page errors and failed requests on a page."""
    page = ctx_page
    IN_FLIGHT[id(page)] = 0

    def moved(n: int, r) -> None:
        if "/api/" in r.url:
            IN_FLIGHT[id(page)] += n
    page.on("request", lambda r: moved(1, r))
    page.on("requestfinished", lambda r: moved(-1, r))
    page.on("requestfailed", lambda r: moved(-1, r))
    page.on("pageerror", lambda e: problems.append(f"page error: {e}"))
    page.on("console", lambda m: problems.append(f"console: {m.text}") if m.type == "error" and not dev_only(m.location.get("url", "")) else None)
    page.on("requestfailed", lambda r: problems.append(f"failed: {r.url}") if not dev_only(r.url) else None)
    page.on("response", lambda r: problems.append(f"{r.status}: {r.url}") if r.status >= 400 and not dev_only(r.url) else None)
    return page


def quiet(page) -> None:
    """Wait until the page's API calls are answered (and stay so for half a second), up to two minutes."""
    calm, end = 0, time.time() + 120
    while time.time() < end and calm < 3:
        calm = calm + 1 if not IN_FLIGHT.get(id(page)) else 0
        page.wait_for_timeout(200)
    time.sleep(0.3)


def check(page, where: str, problems: list, standings: bool = False) -> None:
    body = page.inner_text("body")
    assert page.evaluate("() => document.querySelector('#chip-name').textContent") == "Alder Tech", f"{where}: header"
    assert "Alder Tech" in page.evaluate("() => document.body.textContent"), f"{where}: no Alder Tech"
    assert not NULLISH.search(body), f"{where}: {NULLISH.search(body).group(0)} on the page"
    assert "Kent State" not in body, f"{where}: Kent State on the page"
    assert not OLD_MAC.search(body), f"{where}: the MAC by its old name"
    from sim import fcs_names
    assert not fcs_names.has_old(body), f"{where}: an old FCS stand-in name"
    assert page.evaluate("() => document.documentElement.scrollWidth <= document.documentElement.clientWidth"), f"{where}: sideways scroll"
    if standings:
        assert NEW_CONF in body and RENAMED in body, f"{where}: the conferences on Standings"
    assert not problems, f"{where}: {problems}"


def tabs(page) -> list[str]:
    return page.evaluate("""() => [...document.querySelectorAll('#season-tabs button[data-tab]')]
        .filter((b) => !b.hidden && (b.classList.contains('tab-ovf') || b.offsetWidth > 0)).map((b) => b.dataset.tab)""")


def sweep(page, where: str, problems: list, skip: tuple = ()) -> list[str]:
    seen = []
    for tab in tabs(page):
        if tab in skip:
            continue
        tab_click(page, tab)
        quiet(page)
        check(page, f"{where} {tab}", problems, standings=tab == "standings")
        if tab == "depth":                     # a screen of its own: its team list is the league's, then back to the season
            opts = page.eval_on_selector_all(".dc-team-select option", "os => os.map(o => o.value)")
            assert "alder-tech" in opts and "kent-state" not in opts, f"{where} depth: the team list"
            page.click(".dc-btn-back")
            page.wait_for_selector("#depth-screen", state="hidden", timeout=30_000)
        if os.environ.get("LEAGUE_TABS_VERBOSE"):
            print(f"    {where} {tab} ok", flush=True)
        seen.append(tab)
    return seen


def open_page(browser, base: str, sid: str, w: int, h: int, problems: list):
    page = watched(browser.new_context(viewport={"width": w, "height": h}).new_page(), problems)
    page.goto(f"{base}/index.html?id={sid}")
    page.wait_for_selector("#season:not([hidden])", timeout=120_000)
    page.wait_for_function("() => document.querySelector('#chip-name').textContent === 'Alder Tech'", timeout=60_000)
    quiet(page)
    return page


def start_career(browser, base: str, good: Path) -> str:
    """Import the league on the New Career screen and start it as Alder Tech."""
    problems: list = []
    page = watched(browser.new_page(viewport={"width": 1280, "height": 900}), problems)
    page.goto(f"{base}/index.html")
    page.wait_for_selector("#league-panel #pick-league")
    page.set_input_files("#league-file", str(good))
    page.wait_for_selector("#btn-league-start", timeout=240_000)
    label = page.evaluate("() => [...document.querySelectorAll('#pick-team option')].find((o) => o.value === 'alder-tech').textContent")
    assert "Alder Tech" in label and NEW_CONF in label, label                 # the team picker
    assert not any(o == "kent-state" for o in page.eval_on_selector_all("#pick-team option", "os => os.map(o => o.value)"))
    page.select_option("#pick-team", "alder-tech")
    page.click("#btn-league-start")
    page.wait_for_selector(".modal:not([hidden]) .start-card button.accent", timeout=30_000)
    page.click(".modal:not([hidden]) .start-card button.accent")
    page.wait_for_selector("#season:not([hidden])", timeout=240_000)
    page.wait_for_function("() => document.querySelector('#chip-name').textContent === 'Alder Tech'", timeout=60_000)
    sid = re.search(r"[?&]id=([^&]+)", page.url).group(1)
    assert not problems, problems
    page.close()
    return sid


def finish_season(sid: str) -> None:
    """The season played to its end (faked as in test_offseason.py), in this process, with the server stopped."""
    from coach_career import recruiting
    from sim import season
    from test_offseason import finished
    st = season.load_season(sid)
    season.activate(st)
    finished(st)
    season.save_season(st)
    season.close_pool()
    season.use_league(season.TEAMS_FILE)
    recruiting.use_league_models({})


def offseason(browser, base: str, sid: str, wide, problems: list) -> list[str]:
    """Advance through every stage on the 1280 page, checking each there and on a fresh 400 page; then start 2027."""
    stages = []
    wide.wait_for_selector("#tab-offseason .off-steps", timeout=120_000)
    for _ in range(20):
        quiet(wide)
        stage = call(base, f"/api/season/{sid}/offseason")["stage"]
        btn = wide.inner_text("#tab-offseason .go-btn.primary.big").strip()
        tag = f"offseason {stage} ({btn})"
        check(wide, f"1280 {tag}", problems)
        phone_problems: list = []
        phone = open_page(browser, base, sid, 400, 860, phone_problems)
        phone.wait_for_selector("#tab-offseason .off-steps", timeout=120_000)
        quiet(phone)
        check(phone, f"400 {tag}", phone_problems)
        phone.context.close()
        stages.append(btn)
        if stage == "retention" and not call(base, f"/api/season/{sid}/offseason")["review"]["decided"]:
            call(base, f"/api/season/{sid}/offseason/review", {"action": "nothing", "stage": "retention"})
        if stage == "staff" and wide.query_selector(".off-cand") and not wide.query_selector(".off-cand.picked"):
            wide.click(".off-cand >> nth=0")
            wide.wait_for_selector(".off-cand.picked", timeout=30_000)
        before = wide.evaluate("() => (document.querySelector('#tab-offseason .off-page') || {}).dataset?.key || ''")
        wide.click("#tab-offseason .go-btn.primary.big")
        if btn.startswith("Start the 2027"):
            wide.wait_for_selector(".go-office", timeout=300_000)
            return stages
        wide.wait_for_function("""(b) => { const p = document.querySelector('#tab-offseason .off-page');
            return document.querySelector('.go-office') || (p && p.dataset.key !== b); }""", arg=before, timeout=300_000)
    raise AssertionError(f"the offseason did not end: {stages}")


STARTED: list = []      # the career's id once it starts (cleaned up whatever fails after)


def run(browser, base: str, good: Path) -> str:
    sid = start_career(browser, base, good)
    STARTED.append(sid)
    for w, h in WIDTHS:
        problems: list = []
        page = open_page(browser, base, sid, w, h, problems)
        seen = sweep(page, f"2026 {w}", problems)
        assert {"office", "standings", "schedule", "programs", "recruiting"} <= set(seen), seen
        page.context.close()
        print(f"  2026 at {w}: {len(seen)} tabs")
    return sid


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("league tabs e2e skipped: Playwright is not installed")
        raise SystemExit(0)
    from coach_career import league, league_file
    tmp = Path(tempfile.mkdtemp(prefix="cfp-league-tabs-"))
    good = tmp / "league.json"
    good.write_bytes(league_file.dumps(fixture()))
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    sid = None
    server = start_server(port)
    try:
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"league tabs e2e skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            sid = run(browser, base, good)
            server.terminate()
            server.wait(timeout=30)
            finish_season(sid)
            server = start_server(port)
            problems: list = []
            wide = open_page(browser, base, sid, 1280, 900, problems)
            stages = offseason(browser, base, sid, wide, problems)
            print(f"  offseason: {len(stages)} stages")
            s = call(base, f"/api/season/{sid}")
            assert s["year"] == 2027 and s["team"] == "alder-tech", (s["year"], s["team"])
            # the 1280 page went on to 2027 in place: its cards are the 2027 league's, refetched without a reload
            assert wide.evaluate("() => window.CFP.teamsBySlug['alder-tech'].conference") == NEW_CONF
            assert not wide.evaluate("() => 'kent-state' in window.CFP.teamsBySlug")
            seen = sweep(wide, "2027 1280 (in place)", problems)
            wide.context.close()
            p400: list = []
            phone = open_page(browser, base, sid, 400, 860, p400)
            seen4 = sweep(phone, "2027 400", p400)
            phone.context.close()
            print(f"  2027: {len(seen)} tabs at 1280, {len(seen4)} at 400")
            browser.close()
    finally:
        sid = sid or (STARTED[0] if STARTED else None)
        if sid:
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001 - the cleanup below still runs
                pass
            for f in (ROOT / "data" / "leagues").glob(f"{sid}*"):
                f.unlink(missing_ok=True)
            league.forget(sid)
        server.terminate()
        server.wait(timeout=30)
        good.unlink(missing_ok=True)
        tmp.rmdir()
    print("league tabs e2e ok")
