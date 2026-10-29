"""The game in the browser: the built site (tools/build_site.py) served as static files under a
/sub/ prefix, as GitHub Pages serves a project site (a root-absolute URL would 404), Pyodide in
the Web Worker (web/worker.js) behind the page's fetch shim (web/game-client.js). A seed-11 SMU
career advanced two weeks through the real page gives the scores the native sim gives, the
career comes back from IndexedDB when the page reloads, and a browser that cannot persist the
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
NO_SAVES_TOAST = "saves will not be kept in this browser"
OTHER_TAB = "The game is already open in another tab. Close it and reload this one."
POST = "{method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(%s)}"


def digest(state: dict) -> str:
    played = {e: [g["home_score"], g["away_score"]] for e, g in state["games"].items() if g["played"]}
    return hashlib.sha256(json.dumps(played, sort_keys=True).encode()).hexdigest()[:12]


def native_digest() -> str:
    """Seed-11 SMU career, two weeks, in this process (SIM_WORKERS=1 as in the browser)."""
    st = season.new_season("smu", "full", seed=11, career=True)
    season.advance_to(st, 2)
    return digest(st)


PREFIX = "/sub/"


def serve(folder: _Path) -> tuple[http.server.ThreadingHTTPServer, str]:
    """The built site as plain static files under PREFIX on a free port, the way GitHub Pages
    serves a project site; anything outside PREFIX is a 404."""
    class Prefixed(http.server.SimpleHTTPRequestHandler):
        def _strip(self) -> bool:
            if not self.path.startswith(PREFIX):
                self.send_error(404)
                return False
            self.path = self.path[len(PREFIX) - 1:]
            return True

        def do_GET(self):
            if self._strip():
                super().do_GET()

        def do_HEAD(self):
            if self._strip():
                super().do_HEAD()

        def log_message(self, *args):
            pass
    handler = functools.partial(Prefixed, directory=str(folder))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", free_port()), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}{PREFIX.rstrip('/')}"


def shim(page, path: str, options: str = "{}"):
    """One call through the page's fetch shim: {status, json}."""
    return page.evaluate(f"CFP.game.fetch({path!r}, {options}).then(async (r) => ({{status: r.status, json: await r.json().catch(() => null)}}))")


def watch(page, errors: list, console: list):
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 400 else None)   # a link outside the site
    page.on("console", lambda m: console.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)


def load(page, url: str | None) -> float:
    """Open the page (reload it when url is None) and wait for the game to be ready; the seconds it took."""
    t0 = time.perf_counter()
    if url is None:
        page.reload()
    else:
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
        timings["load"] = load(page, f"{base}/index.html")
        t0 = time.perf_counter()
        r = shim(page, "/api/season", POST % '{team: "smu", seed: 11}')
        assert r["status"] == 200, r
        sid = r["json"]["id"]
        timings["new career"] = time.perf_counter() - t0
        assert shim(page, f"/api/season/{sid}")["status"] == 200     # answered after the save reached IndexedDB
        timings["load again"] = load(page, f"{base}/index.html?id={sid}")   # the page opens it from the store
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
        # Load career is the one call whose body crosses to the worker as bytes (a Blob): export,
        # delete, import the same save and the career is back with its week
        back = page.evaluate(f"""async () => {{
            const bytes = new Uint8Array(await (await CFP.game.fetch('/api/season/{sid}/export?full=true')).arrayBuffer());
            const gone = await CFP.game.fetch('/api/season/{sid}', {{method: 'DELETE'}});
            const missing = (await CFP.game.fetch('/api/season/{sid}')).status;
            const r = await CFP.game.fetch('/api/season/import', {{method: 'POST', headers: {{'Content-Type': 'application/gzip'}},
                                                                body: new Blob([bytes], {{type: 'application/gzip'}})}});
            return {{size: bytes.length, deleted: gone.status, missing, status: r.status, json: await r.json().catch(() => null)}}; }}""")
        assert back["size"] > 1000 and back["deleted"] == 200 and back["missing"] == 404, back
        assert back["status"] == 200 and back["json"]["id"] == sid, back
        assert shim(page, f"/api/season/{sid}")["json"]["current_week"] == 2
        assert page.url == f"{base}/index.html?id={sid}", page.url     # the page keeps its own address
        timings["reload"] = load(page, None)     # a fresh worker: the career comes back from IndexedDB
        page.wait_for_selector("#season:visible")
        assert shim(page, f"/api/season/{sid}")["json"]["current_week"] == 2
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
        load(page, f"{base}/index.html")
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


def test_blocked_storage_at_start_toasts_and_plays(browser, base: str):
    """IndexedDB cannot be read when the worker starts: the game loads anyway, the toast says
    saves will not be kept, and a career can be created, advanced and read back from memory. The
    session is memory-only: a write never writes back to IndexedDB (a write-back of an empty
    mirror would wipe the stored careers), so the start-up toast is the only one."""
    ctx = browser.new_context()
    ctx.add_init_script("""window.__cfpBreakRestore = true;
        window.__toastShows = [];       // the text of every toast as it comes on screen
        document.addEventListener('DOMContentLoaded', () => {
          const t = document.getElementById('toast'); let wasHidden = t.hidden;
          new MutationObserver(() => { if (wasHidden && !t.hidden) window.__toastShows.push(t.textContent); wasHidden = t.hidden; })
            .observe(t, {attributes: true, childList: true, characterData: true, subtree: true}); });""")
    page = ctx.new_page()
    errors, console = [], []
    watch(page, errors, console)
    try:
        load(page, f"{base}/index.html")
        page.wait_for_function(f"() => document.querySelector('#toast').textContent.includes({NO_SAVES_TOAST!r}) && !document.querySelector('#toast').hidden",
                               timeout=10_000)
        r = shim(page, "/api/season", POST % '{team: "smu", seed: 11}')
        assert r["status"] == 200, r
        sid = r["json"]["id"]
        r = shim(page, f"/api/season/{sid}")
        assert r["status"] == 200 and r["json"]["id"] == sid, r
        assert shim(page, f"/api/season/{sid}/advance", POST % '{}')["json"]["status"] == "running"   # a week: several writes
        t0 = time.perf_counter()
        while shim(page, f"/api/season/{sid}/status")["json"]["status"] == "running":
            assert time.perf_counter() - t0 < SIM_TIMEOUT / 1000, "the week did not finish"
            time.sleep(0.5)
        assert shim(page, f"/api/season/{sid}")["json"]["current_week"] == 1
        time.sleep(8)                                        # past the toast's 1 s delay and 6 s on screen
        shows = page.evaluate("window.__toastShows")
        assert len(shows) == 1 and NO_SAVES_TOAST in shows[0], shows
        assert not errors, errors
    finally:
        if console:
            print("console:", *console, sep="\n  ")
        ctx.close()


def test_second_tab_is_refused_and_the_first_keeps_working(browser, base: str):
    """Two tabs of the game in one browser: the second's worker cannot take the store's lock, so
    its overlay says the game is open in another tab, while the first still answers."""
    ctx = browser.new_context()
    first, second = ctx.new_page(), ctx.new_page()
    errors, console = [], []
    watch(first, errors, console)
    try:
        load(first, f"{base}/index.html")
        second.goto(f"{base}/index.html")
        second.wait_for_function(f"() => document.querySelector('#loading-text').textContent.includes({OTHER_TAB!r})", timeout=LOAD_TIMEOUT)
        assert not second.is_hidden("#loading")
        assert second.inner_text("#loading-text").strip() == OTHER_TAB, second.inner_text("#loading-text")   # the copy as it is, no "could not load" prefix
        assert second.evaluate("CFP.game.fetch('/api/teams').then(() => 'ok', (e) => e.message)") == OTHER_TAB
        r = shim(first, "/api/teams")
        assert r["status"] == 200 and r["json"]["teams"], r
        r = shim(first, "/api/season", POST % '{team: "smu", seed: 11}')
        assert r["status"] == 200, r
        assert shim(first, f"/api/season/{r['json']['id']}")["status"] == 200
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
        load(page, f"{base}/index.html")
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
                test_blocked_storage_at_start_toasts_and_plays(browser, base)
                test_second_tab_is_refused_and_the_first_keeps_working(browser, base)
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
