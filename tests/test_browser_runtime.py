"""The game in the browser: the built site (tools/build_site.py) served as static files, Pyodide
in the Web Worker (web/worker.js) behind the page's fetch shim (web/game-client.js). A seed-11
SMU career advanced two weeks through the real page gives the scores the native sim gives, the
career comes back from IndexedDB on a fresh page load, and a browser that cannot persist the
save says so with a toast while the career keeps playing from memory, and a worker that fails
after it was ready tells the page instead of leaving it waiting. Needs Playwright with a
Chromium and the Pyodide CDN; without Playwright it is skipped with the reason. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

ROOT = _Path(__file__).resolve().parents[1]
_sys.path.insert(0, str(ROOT))
_sys.path.insert(0, str(ROOT / "tests"))
import base64
import functools
import hashlib
import http.server
import json
import os
import shutil
import tempfile
import threading
import time

os.environ["SIM_WORKERS"] = "1"    # the browser plays games in-process; the native digest must too
from coach_career import career, league   # noqa: E402
from sim import coaches, season           # noqa: E402
from test_career_e2e import free_port, launch   # noqa: E402
from tools import build_site              # noqa: E402

LOAD_TIMEOUT = 180_000       # Pyodide and game.zip from a cold cache
SIM_TIMEOUT = 120_000        # one week, or a new career
STORAGE_TOAST = "Your browser could not save the career"
POST = "{method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(%s)}"


def digest(state: dict) -> str:
    played = {e: [g["home_score"], g["away_score"]] for e, g in state["games"].items() if g["played"]}
    return hashlib.sha256(json.dumps(played, sort_keys=True).encode()).hexdigest()[:12]


def native_digest() -> str:
    """Seed-11 SMU career, two weeks, in this process (SIM_WORKERS=1 as in the browser)."""
    st = season.new_season("smu", "full", seed=11, career=True)
    season.advance_to(st, 2)
    return digest(st)


def serve(folder: _Path) -> tuple[http.server.ThreadingHTTPServer, str]:
    """The built site as plain static files on a free port, the way GitHub Pages serves it."""
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    handler = functools.partial(Quiet, directory=str(folder))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", free_port()), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def shim(page, path: str, options: str = "{}"):
    """One call through the page's fetch shim: {status, json}."""
    return page.evaluate(f"CFP.game.fetch({path!r}, {options}).then(async (r) => ({{status: r.status, json: await r.json().catch(() => null)}}))")


def watch(page, errors: list, console: list):
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: console.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)


def load(page, url: str) -> float:
    """Open the page and wait for the game to be ready; the seconds it took."""
    t0 = time.perf_counter()
    page.goto(url)
    page.wait_for_selector("#loading", state="visible", timeout=15_000)     # worker mode shows the overlay at once
    page.wait_for_selector("#loading", state="hidden", timeout=LOAD_TIMEOUT)
    return time.perf_counter() - t0


def sim_week(page) -> tuple[float, list]:
    """Click the Office's Sim the week and wait for the page to go idle; the seconds it took and
    the progress bar widths seen on the way (in-week progress reaches the page)."""
    page.wait_for_selector(".go-play")
    t0 = time.perf_counter()
    page.click(".go-play >> text=/Sim the week|ADVANCE THE WEEK/")
    page.wait_for_selector("body.simming", timeout=10_000)
    widths = []
    while time.perf_counter() - t0 < SIM_TIMEOUT / 1000:
        w = page.evaluate("() => document.body.classList.contains('simming') ? document.querySelector('#season-progress-bar').style.width : null")
        if w is None:
            break
        if w and w not in widths:
            widths.append(w)
        time.sleep(0.2)
    else:
        raise AssertionError("the week did not finish")
    return time.perf_counter() - t0, widths


def test_two_weeks_match_native_and_reload_restores(browser, base: str, timings: dict):
    page = browser.new_context().new_page()
    errors, console = [], []
    watch(page, errors, console)
    try:
        timings["load"] = load(page, f"{base}/season.html")
        t0 = time.perf_counter()
        r = shim(page, "/api/season", POST % '{team: "smu", seed: 11}')
        assert r["status"] == 200, r
        sid = r["json"]["id"]
        timings["new career"] = time.perf_counter() - t0
        assert shim(page, f"/api/season/{sid}")["status"] == 200     # answered after the save reached IndexedDB
        timings["load again"] = load(page, f"{base}/season.html?id={sid}")   # the page opens it from the store
        page.wait_for_selector("#season:visible")
        for week in (1, 2):
            timings[f"week {week}"], widths = sim_week(page)
            assert shim(page, f"/api/season/{sid}")["json"]["current_week"] == week
            assert len(widths) >= 2, f"no in-week progress reached the page: {widths} (week {week} took {timings[f'week {week}']:.1f}s)"
        b64 = page.evaluate(f"""CFP.game.fetch('/api/season/{sid}/export').then(async (r) => {{
            const b = new Uint8Array(await r.arrayBuffer()); let s = "";
            for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
            return btoa(s); }})""")
        state = career.read_save(base64.b64decode(b64))[0]
        assert state["current_week"] == 2
        assert digest(state) == native_digest(), "the browser's scores differ from the native sim's"
        # the page's own copy (careersave.js) goes first, so only the worker's IndexedDB can bring the career back
        page.evaluate(f"window.CareerSave.remove({sid!r})")
        assert page.evaluate("window.CareerSave.list().then((l) => l.length)") == 0
        timings["reload"] = load(page, f"{base}/season.html?id={sid}")     # a fresh worker: the career comes back from IndexedDB
        page.wait_for_selector("#season:visible")
        assert shim(page, f"/api/season/{sid}")["json"]["current_week"] == 2
        assert "restored from this device" not in page.inner_text("#toast")
        assert not errors, errors
    finally:
        if console:
            print("console:", *console, sep="\n  ")
        page.context.close()


def test_syncfs_failure_toasts(browser, base: str):
    ctx = browser.new_context()
    ctx.add_init_script("window.__cfpBreakStorage = true")
    page = ctx.new_page()
    errors, console = [], []
    watch(page, errors, console)
    try:
        load(page, f"{base}/season.html")
        page.select_option("#pick-team", "smu")
        page.click("#btn-new")
        page.click(".start-card button.accent")          # take over as the team's own head coach
        page.wait_for_function(f"() => document.querySelector('#toast').textContent.includes({STORAGE_TOAST!r}) && !document.querySelector('#toast').hidden",
                               timeout=SIM_TIMEOUT)
        page.wait_for_selector("#season:visible")
        sid = page.evaluate("new URLSearchParams(location.search).get('id')")
        assert sid, "the page did not open the career"
        r = shim(page, f"/api/season/{sid}")
        assert r["status"] == 200 and r["json"]["id"] == sid, r
        assert not errors, errors
    finally:
        if console:
            print("console:", *console, sep="\n  ")
        ctx.close()


def test_worker_failure_after_ready_reaches_the_page(browser, base: str):
    """The sim step crashes in the worker: every call in flight or after rejects with the reason
    (nothing hangs on a stale "running" snapshot) and the overlay says the game could not load."""
    ctx = browser.new_context()
    ctx.add_init_script("window.__cfpBreakStep = true")
    page = ctx.new_page()
    errors, console = [], []
    watch(page, errors, console)
    try:
        load(page, f"{base}/season.html")
        sid = shim(page, "/api/season", POST % '{team: "smu", seed: 11}')["json"]["id"]
        outcomes = page.evaluate(f"""async () => {{
            await CFP.game.fetch('/api/season/{sid}/advance', {POST % '{}'});
            const calls = [];
            for (let i = 0; i < 50; i++) {{ calls.push(CFP.game.fetch('/api/teams').then(() => "ok", (e) => e.message)); await new Promise((r) => setTimeout(r, 20)); }}
            return Promise.all(calls); }}""")
        failed = [o for o in outcomes if o != "ok"]
        assert failed and all("The game could not load" in o for o in failed), outcomes
        assert outcomes[-1] != "ok", outcomes
        page.wait_for_selector("#loading", state="visible", timeout=10_000)
        assert "The game could not load" in page.inner_text("#loading")
        assert page.evaluate(f"CFP.game.fetch('/api/season/{sid}/status').then(() => 'ok', (e) => e.message)") != "ok"
        assert not errors, errors
    finally:
        console = [c for c in console if "the sim step is switched off" not in c]   # the injected crash, logged by the worker
        if console:
            print("console:", *console, sep="\n  ")
        ctx.close()


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("browser runtime skipped: Playwright is not installed")
        raise SystemExit(0)
    written = [f for f in (league.BASE_LEAGUE_FILE, league.BASE_META_FILE) if not f.exists()]   # the build writes these into data/
    tmp = _Path(tempfile.mkdtemp(prefix="cfp-browser-"))
    season.SEASONS_DIR, coaches.COACHES_DIR = tmp / "seasons", tmp / "coaches"    # the native digest's files
    timings: dict = {}
    try:
        build_site.build(tmp / "dist")
        httpd, base = serve(tmp / "dist")
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"browser runtime skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            try:
                test_two_weeks_match_native_and_reload_restores(browser, base, timings)
                test_syncfs_failure_toasts(browser, base)
                test_worker_failure_after_ready_reaches_the_page(browser, base)
            finally:
                browser.close()
        httpd.shutdown()
    finally:
        season.close_pool()
        shutil.rmtree(tmp, ignore_errors=True)
        for f in written:
            f.unlink(missing_ok=True)
    print("browser runtime ok: " + ", ".join(f"{k} {v:.1f}s" for k, v in timings.items()))
