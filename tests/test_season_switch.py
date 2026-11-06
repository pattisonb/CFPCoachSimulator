"""Switching between saved seasons (the player's "switching between seasons doesn't really work or is
maybe slow"). Two careers, one in its first season and one rolled into 2027 on its own league:
- the dispatcher builds a later season's league once (a missing teams file), never again on a switch;
- a save file seen unchanged is not scanned again for the FCS stand-ins' old names on every open;
- in the page, picking the other save from Seasons ▾ twice lands on the right team each time, with a
  toast while it opens and the menu marking the open one; a pick while a week sims gets a toast and
  sends nothing (the server would otherwise hold the open until the week is done, then switch under
  the sim). Needs Playwright with a Chromium for the page part; without one that part is skipped.
(Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

ROOT = _Path(__file__).resolve().parents[1]
_sys.path.insert(0, str(ROOT))
_sys.path.insert(0, str(ROOT / "tests"))
import os
import shutil
import sys
import subprocess
import time
import urllib.request

from app import api
from coach_career import league, offseason
from sim import fcs_names, season
from test_career_e2e import call, free_port, launch
from test_offseason import finished

SIM_HOLD = "Wait for the sim to finish, then switch seasons."


def make_saves() -> tuple[str, str]:
    """A: Georgia, a career at week 0 of 2026. B: Ohio State, a career rolled into 2027 (a faked season)."""
    b = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(b)
    offseason.start(b)
    while b["offseason"]["stage"] != "ready":
        offseason.advance(b)
    b = offseason.next_season(b)
    season.save_season(b)
    season.use_league(None)
    a = season.new_season("georgia", "full", seed=7, career=True)
    season.save_season(a)
    return a["id"], b["id"]


def engine(a: str, b: str) -> None:
    builds, scans = [], []
    real_build, real_rewrite = league.build, fcs_names.rewrite_text
    league.build = lambda *x, **k: (builds.append(1), real_build(*x, **k))[1]
    fcs_names.rewrite_text = lambda t: (scans.append(1), real_rewrite(t))[1]
    season._names_current.clear()         # as a fresh process: neither save seen yet
    try:
        times = []
        for sid in (a, b, a, b, a, b):
            t0 = time.perf_counter()
            assert api.call("GET", f"/api/season/{sid}")["id"] == sid
            times.append(time.perf_counter() - t0)
        assert not builds, f"a switch rebuilt a league {len(builds)} times"
        assert len(scans) == 2, f"the saves were scanned for old names {len(scans)} times over six opens (once each is enough)"
        assert season._league_path == league.path(b, 2027)
        # a later season's league missing (the browser keeps it in memory only): built once, then reused
        api.call("GET", f"/api/season/{a}")
        league.path(b, 2027).unlink()
        for sid in (b, a, b, a, b):
            api.call("GET", f"/api/season/{sid}")
        assert len(builds) == 1, f"the missing league was built {len(builds)} times"
        # a save changed on disk by anyone else is scanned again (its names may be old)
        path = season.SEASONS_DIR / f"{a}.json"
        api.call("GET", f"/api/season/{b}")
        path.write_text(path.read_text(encoding="utf-8") + " ", encoding="utf-8")
        before = len(scans)
        api.call("GET", f"/api/season/{a}")
        assert len(scans) == before + 1, "a save changed on disk was not scanned for old names"
        print("switch times (ms): " + ", ".join(f"{t * 1000:.0f}" for t in times))
    finally:
        league.build, fcs_names.rewrite_text = real_build, real_rewrite


def seasons_menu(page) -> None:
    if not page.is_visible("#btn-seasons-menu"):
        page.click("#btn-menu")
        page.click(".go-menu .go-menu-item:has(b:has-text('Show the Top Bar'))")
    page.click("#btn-seasons-menu")
    page.wait_for_selector(".season-menu .go-menu-item")


def pick(page, label: str) -> None:
    seasons_menu(page)
    page.click(f".season-menu .go-menu-item:has(b:has-text('{label}'))")


def browser(a: str, b: str) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("season switch page part skipped: Playwright is not installed")
        return
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
                br = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"season switch page part skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                return
            page = br.new_page()
            errors, gets = [], []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("request", lambda r: gets.append(r.url[len(base):]) if "/api/season/" in r.url else None)
            page.add_init_script("""window.__toasts = [];
                document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => {
                  for (const n of document.querySelectorAll('#toasts .toast-item'))
                    if (!window.__toasts.includes(n.textContent)) window.__toasts.push(n.textContent); })
                  .observe(document.body, {subtree: true, childList: true, characterData: true}));""")
            page.goto(f"{base}/index.html?id={a}")
            page.wait_for_selector("#season:visible")
            page.wait_for_function("() => document.querySelector('#chip-name').textContent.includes('Georgia')")
            for sid, team, label in ((b, "Ohio State", "Ohio State"), (a, "Georgia", "Georgia"), (b, "Ohio State", "Ohio State")):
                page.evaluate("window.__toasts = []")
                pick(page, label)
                page.wait_for_function(f"() => new URLSearchParams(location.search).get('id') === {sid!r} && document.querySelector('#chip-name').textContent.includes({team!r})", timeout=60_000)
                page.wait_for_function("() => !document.querySelector('#btn-seasons-menu').classList.contains('go-busy')", timeout=60_000)
                toasts = page.evaluate("window.__toasts")
                assert f"Opening {team}…" in toasts, toasts
                seasons_menu(page)
                current = page.locator(".season-menu .go-menu-item.current b").all_inner_texts()
                assert len(current) == 1 and current[0].startswith(team), current
                page.keyboard.press("Escape")
                page.wait_for_function(f"() => [...document.querySelectorAll('#season-list li.active')].map((n) => n.dataset.id).join() === {sid!r}", timeout=10_000)
            # a pick while the week sims: a toast, no request, and the page stays on the season simming
            page.wait_for_selector(".go-play")
            page.click(".go-play >> text=/Sim the Week|ADVANCE THE WEEK/")
            page.wait_for_selector("body.simming", timeout=10_000)
            page.evaluate("window.__toasts = []")
            gets.clear()
            pick(page, "Georgia")
            page.wait_for_function(f"() => window.__toasts.includes({SIM_HOLD!r})", timeout=5_000)
            assert not [g for g in gets if g.startswith(f"/api/season/{a}")], gets
            page.wait_for_function("() => !document.body.classList.contains('simming')", timeout=180_000)
            page.wait_for_timeout(1500)
            assert page.evaluate("new URLSearchParams(location.search).get('id')") == b
            assert "Ohio State" in page.inner_text("#chip-name")
            assert not [g for g in gets if g.startswith(f"/api/season/{a}")], gets
            assert call(base, f"/api/season/{b}")["current_week"] == 1
            assert not errors, errors
            br.close()
    finally:
        server.terminate()
        server.wait(timeout=30)


if __name__ == "__main__":
    a, b = make_saves()
    try:
        engine(a, b)
        browser(a, b)
    finally:
        season.close_pool()
        for sid in (a, b):
            (season.SEASONS_DIR / f"{sid}.json").unlink(missing_ok=True)
            shutil.rmtree(season.SEASONS_DIR / sid, ignore_errors=True)       # its box scores
            league.forget(sid)
        season.use_league(None)
    print("season switch ok")
