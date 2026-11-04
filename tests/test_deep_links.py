"""Deep links in a browser (web/route.js): every place on the season page has a URL, a reload lands
in the same place, and Back goes where the player came from. Each place is reached by clicking, the
address is checked, the page reloads and the same place must be on screen: the Office, the
Recruiting board on a stage tab with a recruit in the pane on its Scouting sub-tab, a prospect
profile, a player page from the stats, a box score from the schedule with a player page over it, the
depth chart and an offseason view. A link with a recruit or a game that is not there falls back to
the view under it, quietly. Needs Playwright with a Chromium; without one it is skipped.
(Run as a file: multiprocessing on Windows.)"""
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

LEAKS = re.compile(r"\b(undefined|null|NaN)\b")


def params(page) -> dict:
    """The page's query as a dict; `modal` as a list (bottom to top)."""
    q = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)
    out = {k: v[0] for k, v in q.items() if k != "modal"}
    out["modal"] = q.get("modal", [])
    return out


def wait_url(page, pred, what: str, timeout: float = 30) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        p = params(page)
        if pred(p):
            return p
        time.sleep(0.1)
    raise AssertionError(f"the address never showed {what}: {page.url}")


def reload(page, wait: str = "#season:visible") -> None:
    page.reload()
    page.wait_for_selector(wait, timeout=120_000)


def tab_on(page, tab: str) -> bool:
    return page.evaluate(f"() => !document.querySelector('#tab-{tab}').hidden && document.querySelector('#season-tabs button[data-tab={tab}]').classList.contains('active')")


def modals(page) -> int:
    return page.evaluate("() => [...document.querySelectorAll('.modal')].filter(m => !m.hidden).length")


def clean(page, errors) -> None:
    assert not errors, errors
    body = page.inner_text("body")
    assert not LEAKS.search(body), LEAKS.search(body).group(0)
    assert not page.query_selector(".toast-item.error"), page.inner_text(".toast-item.error")


def advance_to(base: str, sid: str, week: int) -> None:
    call(base, f"/api/season/{sid}/advance", {"to": week})
    for _ in range(1200):
        if call(base, f"/api/season/{sid}/status?since=0")["status"] != "running":
            break
        time.sleep(0.5)
    assert call(base, f"/api/season/{sid}")["current_week"] == week


def check_office_and_back(page, base, A, errors) -> None:
    page.goto(f"{base}/index.html?id={A}")
    page.wait_for_selector("#season:visible")
    tab_click(page, "schedule")
    wait_url(page, lambda p: p.get("tab") == "schedule", "tab=schedule")
    tab_click(page, "office")
    wait_url(page, lambda p: p.get("tab") == "office", "tab=office")
    page.wait_for_selector("#tab-office .go-play")
    reload(page)
    page.wait_for_selector("#tab-office .go-play", timeout=60_000)
    assert tab_on(page, "office") and params(page)["tab"] == "office"
    # Back from a tab: the tab before it
    tab_click(page, "standings")
    wait_url(page, lambda p: p.get("tab") == "standings", "tab=standings")
    tab_click(page, "rankings")
    wait_url(page, lambda p: p.get("tab") == "rankings", "tab=rankings")
    page.go_back()
    wait_url(page, lambda p: p.get("tab") == "standings", "tab=standings after Back")
    page.wait_for_function("() => !document.querySelector('#tab-standings').hidden")
    assert tab_on(page, "standings")
    page.go_back()
    wait_url(page, lambda p: p.get("tab") == "office", "tab=office after a second Back")
    page.wait_for_function("() => !document.querySelector('#tab-office').hidden")
    page.go_forward()
    wait_url(page, lambda p: p.get("tab") == "standings", "tab=standings after Forward")
    page.wait_for_function("() => !document.querySelector('#tab-standings').hidden")
    clean(page, errors)


def check_board(page, base, A, errors) -> None:
    page.goto(f"{base}/index.html?id={A}")
    page.wait_for_selector("#season:visible")
    tab_click(page, "recruiting")
    page.wait_for_selector(".go-row-recruit", timeout=60_000)
    # a stage tab other than All that holds two or more, the second row in it, his Scouting sub-tab
    stage = page.evaluate("""() => { const b = [...document.querySelectorAll('.go-stages button[data-stage]')]
        .filter(x => x.dataset.stage !== 'all' && Number(x.querySelector('b').textContent) >= 2); return b.length ? b[0].dataset.stage : null; }""")
    assert stage, "no stage tab holds two recruits"
    page.click(f".go-stages button[data-stage={stage}]")
    page.wait_for_function(f"() => document.querySelector('.go-stages button[data-stage={stage}]').getAttribute('aria-pressed') === 'true'")
    page.wait_for_function("() => !document.querySelector('.go-row-recruit.go-leaving')")      # the rows of the other tabs have faded out
    pid = page.eval_on_selector_all(".go-row-recruit", "els => els[1].dataset.pid")
    page.click(f".go-row-recruit[data-pid='{pid}']")
    page.click(".go-pane .go-subtabs button[data-sub=scouting]")
    p = wait_url(page, lambda p: p.get("stage") == stage and p.get("pid") == pid and p.get("pane") == "scouting", f"stage={stage}, pid={pid}, pane=scouting")
    assert p["tab"] == "recruiting"
    reload(page)
    page.wait_for_selector(f".go-pane .go-subtabs button[data-sub=scouting][aria-selected=true]", timeout=60_000)
    assert page.get_attribute(f".go-stages button[data-stage={stage}]", "aria-pressed") == "true"
    assert page.get_attribute(".go-row-recruit.selected", "data-pid") == pid
    assert tab_on(page, "recruiting")
    p = params(page)
    assert (p.get("stage"), p.get("pid"), p.get("pane")) == (stage, pid, "scouting"), p
    # a pane sub-tab and another recruit replace the entry: Back leaves the board for the tab before it
    page.click(".go-pane .go-subtabs button[data-sub=overview]")
    wait_url(page, lambda p: "pane" not in p, "the Overview sub-tab (the default) out of the address")
    clean(page, errors)


def check_profile(page, base, A, errors) -> None:
    page.goto(f"{base}/index.html?id={A}")
    page.wait_for_selector("#season:visible")
    tab_click(page, "prospects")
    page.wait_for_selector(".go-list-row", timeout=60_000)
    page.click(".go-list-row .go-list-id >> nth=0")
    page.wait_for_selector(".modal:not([hidden]) .rc-profile-name", timeout=60_000)
    name = page.inner_text(".modal:not([hidden]) .rc-profile-name")
    p = wait_url(page, lambda p: len(p["modal"]) == 1 and p["modal"][0].startswith("profile:"), "modal=profile:…")
    assert p["tab"] == "prospects"
    reload(page)
    page.wait_for_selector(".modal:not([hidden]) .rc-profile-name", timeout=60_000)
    assert page.inner_text(".modal:not([hidden]) .rc-profile-name") == name
    assert tab_on(page, "prospects") and modals(page) == 1
    # closing it (the ✕) drops it from the address
    page.click(".modal:not([hidden]) .modal-close")
    wait_url(page, lambda p: not p["modal"], "no modal after the close")
    assert modals(page) == 0
    # Back from a modal: the view under it
    page.click(".go-list-row .go-list-id >> nth=1")
    page.wait_for_selector(".modal:not([hidden]) .rc-profile-name", timeout=60_000)
    wait_url(page, lambda p: len(p["modal"]) == 1, "a modal")
    page.go_back()
    wait_url(page, lambda p: not p["modal"], "no modal after Back")
    page.wait_for_function("() => ![...document.querySelectorAll('.modal')].some(m => !m.hidden)")
    assert tab_on(page, "prospects")
    clean(page, errors)


def check_player_from_stats(page, base, A, errors) -> None:
    page.goto(f"{base}/index.html?id={A}")
    page.wait_for_selector("#season:visible")
    tab_click(page, "stats")
    page.wait_for_selector("#tab-playerstats select[aria-label=Team]", timeout=60_000)
    page.select_option("#tab-playerstats select[aria-label=Team]", "smu")
    page.click("#tab-playerstats .view-chips button:has-text('Roster')")
    wait_url(page, lambda p: p.get("sview") == "roster", "sview=roster")
    page.wait_for_selector("#tab-playerstats [data-player]", timeout=60_000)
    page.click("#tab-playerstats [data-player] >> nth=0")
    page.wait_for_selector(".modal:not([hidden]) .player-page", timeout=60_000)
    title = page.inner_text(".modal:not([hidden]) .modal-title")
    wait_url(page, lambda p: len(p["modal"]) == 1 and p["modal"][0].startswith("player:"), "modal=player:…")
    reload(page)
    page.wait_for_selector(".modal:not([hidden]) .player-page", timeout=60_000)
    assert page.inner_text(".modal:not([hidden]) .modal-title") == title
    assert tab_on(page, "stats")
    page.click(".modal:not([hidden]) .modal-close")
    page.wait_for_selector("#tab-playerstats .view-chips button.active:has-text('Roster')", timeout=60_000)   # the roster under it, as it was
    clean(page, errors)
    # the League's Programs tab (a career): its own address, back after a reload
    if page.evaluate("() => !document.querySelector('#season-tabs button[data-tab=programs]').hidden"):
        tab_click(page, "programs")
        wait_url(page, lambda p: p.get("tab") == "programs", "tab=programs")
        page.wait_for_selector("#tab-programs .go-programs tbody tr", timeout=60_000)
        reload(page)
        page.wait_for_selector("#tab-programs .go-programs tbody tr", timeout=60_000)
        assert tab_on(page, "programs")
        clean(page, errors)


def check_box_and_stack(page, base, A, errors) -> None:
    page.goto(f"{base}/index.html?id={A}")
    page.wait_for_selector("#season:visible")
    tab_click(page, "schedule")
    page.click("#week-strip button.week-chip[aria-label='Week 2']")
    wait_url(page, lambda p: p.get("week") == "2", "week=2")
    page.wait_for_selector("#tab-schedule .clickable", timeout=60_000)
    page.click("#tab-schedule .clickable >> nth=0")
    page.wait_for_selector(".modal:not([hidden]) #sbox-score-row", timeout=60_000)
    score = page.inner_text("#sbox-score-row")
    p = wait_url(page, lambda p: len(p["modal"]) == 1 and p["modal"][0].startswith("box:"), "modal=box:…")
    assert p["tab"] == "schedule"
    reload(page)
    page.wait_for_selector(".modal:not([hidden]) #sbox-score-row", timeout=60_000)
    assert page.inner_text("#sbox-score-row") == score
    assert tab_on(page, "schedule") and params(page).get("week") == "2"
    assert page.get_attribute("#week-strip button.week-chip.active", "aria-label") == "Week 2"
    # a player page over the box score: both in the address, both back after a reload, Back closes the top one
    page.click("#sbox-tabs button[data-btab=home]")
    page.click("#sbox-home [data-player] >> nth=0")
    page.wait_for_selector(".modal-nested:not([hidden]) .player-page", timeout=60_000)
    wait_url(page, lambda p: len(p["modal"]) == 2 and p["modal"][1].startswith("player:"), "modal=box:…&modal=player:…")
    reload(page)
    page.wait_for_selector(".modal-nested:not([hidden]) .player-page", timeout=60_000)
    assert modals(page) == 2
    page.click(".modal-nested .modal-close")
    p = wait_url(page, lambda p: len(p["modal"]) == 1, "the box score alone after the player page closed")
    assert p["modal"][0].startswith("box:") and modals(page) == 1
    page.click("#sbox-tabs button[data-btab=home]")
    page.click("#sbox-home [data-player] >> nth=0")
    page.wait_for_selector(".modal-nested:not([hidden]) .player-page", timeout=60_000)
    wait_url(page, lambda p: len(p["modal"]) == 2, "two modals")
    page.go_back()
    wait_url(page, lambda p: len(p["modal"]) == 1, "the box score after Back")
    page.wait_for_function("() => !document.querySelector('.modal-nested')")
    assert modals(page) == 1
    clean(page, errors)


def check_depth(page, base, A, errors) -> None:
    page.goto(f"{base}/index.html?id={A}")
    page.wait_for_selector("#season:visible")
    tab_click(page, "standings")
    wait_url(page, lambda p: p.get("tab") == "standings", "tab=standings")
    tab_click(page, "depth")
    page.wait_for_selector("#depth-screen:not([hidden])", timeout=60_000)
    p = wait_url(page, lambda p: p.get("screen") == "depth", "screen=depth")
    assert p["tab"] == "standings"
    reload(page, "#depth-screen:not([hidden])")      # the depth chart covers the season
    assert params(page).get("screen") == "depth"
    page.go_back()
    wait_url(page, lambda p: "screen" not in p, "the season after Back")
    page.wait_for_selector("#depth-screen", state="hidden")
    page.wait_for_function("() => !document.querySelector('#tab-standings').hidden")
    clean(page, errors)


def check_offseason(page, base, B, errors) -> None:
    page.goto(f"{base}/index.html?id={B}")
    page.wait_for_selector("#tab-offseason .off-steps", timeout=120_000)    # a finished career opens on the offseason
    wait_url(page, lambda p: p.get("tab") == "offseason", "tab=offseason")
    tab_click(page, "rankings")
    page.click("#poll-pills button[data-poll=coaches]")
    wait_url(page, lambda p: p.get("tab") == "rankings" and p.get("poll") == "coaches", "tab=rankings&poll=coaches")
    reload(page)
    page.wait_for_selector("#poll-body table", timeout=60_000)
    assert tab_on(page, "rankings"), "the offseason career reloads on the tab it was on, not its landing tab"
    assert page.get_attribute("#poll-pills button.active", "data-poll") == "coaches"
    tab_click(page, "offseason")
    wait_url(page, lambda p: p.get("tab") == "offseason" and "poll" not in p, "tab=offseason, the poll dropped")
    page.wait_for_selector("#tab-offseason .off-steps", timeout=60_000)
    reload(page)
    page.wait_for_selector("#tab-offseason .off-steps", timeout=60_000)
    assert tab_on(page, "offseason")
    clean(page, errors)


def check_fallbacks(page, base, A, errors) -> None:
    # a recruit, a game, a profile and a player that are not there; a tab that does not exist
    q = urllib.parse.urlencode([("id", A), ("tab", "recruiting"), ("stage", "nowhere"), ("pid", "no-such-recruit"), ("pane", "nope"),
                                ("modal", "box:999999999"), ("modal", "profile:no-such-recruit")])
    page.goto(f"{base}/index.html?{q}")
    page.wait_for_selector("#season:visible")
    page.wait_for_selector(".go-row-recruit.selected", timeout=60_000)
    time.sleep(1.5)
    assert tab_on(page, "recruiting") and modals(page) == 0
    p = params(page)
    assert not p["modal"] and p.get("pid") != "no-such-recruit" and "stage" not in p and "pane" not in p, p
    clean(page, errors)
    q = urllib.parse.urlencode([("id", A), ("tab", "no-such-tab"), ("week", "77"), ("modal", "player:nobody|Nobody Here|QB"), ("modal", "resume:nowhere|3")])
    page.goto(f"{base}/index.html?{q}")
    page.wait_for_selector("#season:visible")
    page.wait_for_selector("#tab-office .go-play", timeout=60_000)        # a career's own landing tab
    time.sleep(1.5)
    assert modals(page) == 0
    p = params(page)
    assert p.get("tab") == "office" and not p["modal"] and "week" not in p, p
    clean(page, errors)


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("deep links skipped: Playwright is not installed")
        raise SystemExit(0)
    from sim import season
    from test_offseason import finished
    fresh = season.new_season("smu", "full", seed=62, career=True)
    season.save_season(fresh)
    done = season.new_season("ohio-state", "full", seed=8, career=True)
    finished(done)
    season.save_season(done)
    A, B = fresh["id"], done["id"]
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port), "CFP_QUESTION_RATE": "0"},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(base + "/api/teams", timeout=2)
                break
            except OSError:
                time.sleep(0.5)
        advance_to(base, A, 2)          # SMU is idle in week 1: its first game, with a box score, is week 2
        # a board to look at: the top prospects on it
        for r in call(base, f"/api/season/{A}/prospects?limit=12")["rows"]:
            call(base, f"/api/season/{A}/board", {"pid": r["id"], "on": True})
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"deep links skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.dismiss())
            check_office_and_back(page, base, A, errors)
            check_board(page, base, A, errors)
            check_profile(page, base, A, errors)
            check_player_from_stats(page, base, A, errors)
            check_box_and_stack(page, base, A, errors)
            check_depth(page, base, A, errors)
            check_offseason(page, base, B, errors)
            check_fallbacks(page, base, A, errors)
            browser.close()
        print("deep links ok: the Office, the board (stage, recruit, sub-tab), a profile, a player page, a box score with a player over it, "
              "the depth chart and an offseason view all reload in place; Back closes a modal and returns to the tab before; bad ids fall back quietly")
    finally:
        for sid in (A, B):
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
        server.terminate()
