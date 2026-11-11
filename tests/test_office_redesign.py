"""The Office redesign (web/office.js, GET /api/season/{id}/office, coach_career/office.py).

The read: a fresh career has no program news and no conference results yet, and a standing row; after a week the news
carries your game (newest week first, at most office.NEWS_ITEMS) and the conference card that week's results (your
conference's teams only, conference games first, at most office.CONF_GAMES). Nothing in the read changes the season.

The page, at 1280 and 400 px in the dark and the light theme: the Next Game hero (week, Home/Away chip, both teams with
records, Win Chance between 1% and 99%, Game Day), Last Game (the score and four team stats), This Week's Plan (Recruit,
Game Day, Advance: the current step follows recruiting hours spent and the game played; a bye drops Game Day), Program
News (weeks, not hours), Around the Conference, Program Pulse, Recruiting Pulse and Top Targets, every value real (no
null, undefined or NaN), every kicker in Title Case, one column below 900 px and no sideways scroll at 400 px. Game Day
plays your game as the old play card did. The season over shows the Season Complete hero with On to the Offseason and no
plan card. Needs Playwright with a Chromium for the page; skipped without one. (Run as a file.)"""
import copy
import json
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

BAD = ("null", "undefined", "NaN")
SMALL = {"a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by", "vs"}


# ----- the read, in process -----------------------------------------------------------------------------

def check_read() -> None:
    from coach_career import office
    from sim import season
    st = season.new_season("smu", "full", seed=23, career=True)
    before = json.dumps(st, sort_keys=True, default=str)
    v = office.office_view(st)
    assert json.dumps(st, sort_keys=True, default=str) == before, "the read changes nothing"
    assert v["news"] == [] and v["conference"]["games"] == [], v
    assert v["conference"]["name"] == season.load_teams()["smu"]["conference"]
    stand = v["conference"]["standing"]
    assert stand and stand["slug"] == "smu" and stand["wins"] == 0 and stand["of"] >= 2, stand
    # a week later: one advance in process
    season.advance(st)
    st2 = copy.deepcopy(st)
    v = office.office_view(st)
    assert st == st2, "the read changes nothing"
    teams = season.load_teams()
    conf = teams["smu"]["conference"]
    games = v["conference"]["games"]
    assert 0 < len(games) <= office.CONF_GAMES, games
    assert all(teams[g["home"]]["conference"] == conf or teams[g["away"]]["conference"] == conf for g in games), games
    assert all(isinstance(g["home_score"], int) and isinstance(g["away_score"], int) for g in games), games
    flags = [g["conference_game"] for g in games]
    assert flags == sorted(flags, reverse=True), "conference games first"
    assert len({g["week"] for g in games}) == 1 and games[0]["week"] == v["conference"]["week"]
    news = v["news"]
    assert len(news) <= office.NEWS_ITEMS
    weeks = [n["week"] for n in news]
    assert weeks == sorted(weeks, reverse=True), "newest week first"
    mine = [x for x in st["games"].values() if x["played"] and st["team"] in (x["home"], x["away"])]
    if mine:
        g = next(n for n in news if n["kind"] == "game")
        assert g["opponent_name"] and isinstance(g["points_for"], int), g
    for n in news:
        if n["kind"] != "game":
            assert n["name"] and n["position"] and 1 <= n["stars"] <= 5, n
    print("  read ok:", len(news), "news,", len(games), "conference results")


# ----- the page ----------------------------------------------------------------------------------------

def title_case(text: str) -> bool:
    """Every word of a label starts with a capital (small words inside excepted), numbers and marks pass."""
    words = [w for w in re.split(r"[\s·/→▾▶]+", text.strip()) if w]
    for i, w in enumerate(words):
        core = w.strip("'’(),.:#&-")
        if not core or not core[0].isalpha():
            continue
        if core.lower() in SMALL and 0 < i < len(words) - 1:
            continue
        if not core[0].isupper():
            return False
    return True


def open_office(page, base, sid, wait=".ofc-hero"):
    page.goto(f"{base}/index.html?id={sid}&tab=office")
    page.wait_for_selector("#season:visible", timeout=120_000)
    page.wait_for_selector(f"#tab-office {wait}", timeout=120_000)
    page.wait_for_selector("#tab-office .ofc-recruit .ofc-big", timeout=120_000)
    page.wait_for_function("() => !document.querySelector('#tab-office .go-loading')", timeout=120_000)
    time.sleep(0.6)


def clean(page) -> None:
    text = page.inner_text("#tab-office")
    for bad in BAD:
        assert not re.search(rf"\b{bad}\b", text), f"{bad!r} on the Office: {text[:600]}"


def kickers_title_case(page) -> None:
    labels = page.eval_on_selector_all(
        "#tab-office .go-kicker, #tab-office .ofc-label, #tab-office .ofc-chip, #tab-office .go-tag, #tab-office .ofc-step b, "
        "#tab-office button.go-btn, #tab-office .ofc-stat span",
        "els => els.filter(e => e.offsetParent).map(e => e.textContent.trim()).filter(Boolean)")
    bad = [t for t in labels if not title_case(t)]
    assert not bad, f"labels not in Title Case: {bad}"


def no_sideways(page) -> None:
    assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "sideways scroll on the Office"


def columns(page) -> int:
    return page.evaluate("() => getComputedStyle(document.querySelector('#tab-office .ofc-grid')).gridTemplateColumns.split(' ').length")


def win_chance(page) -> tuple:
    page.wait_for_selector("#tab-office .ofc-odds", timeout=120_000)
    mine = page.inner_text("#tab-office .ofc-odds .ofc-odds-mine")
    theirs = page.inner_text("#tab-office .ofc-odds .ofc-odds-theirs")
    a, b = int(mine.rstrip("%")), int(theirs.rstrip("%"))
    assert 1 <= a <= 99 and 1 <= b <= 99 and a + b == 100, (mine, theirs)
    return a, b


def plan(page) -> list:
    return page.eval_on_selector_all("#tab-office .ofc-plan .ofc-step",
                                      "els => els.map(e => [e.querySelector('b').textContent, e.classList.contains('now') ? 'now' : e.classList.contains('done') ? 'done' : e.classList.contains('part') ? 'part' : ''])")


def check_cards(page, base, sid) -> None:
    s = call(base, f"/api/season/{sid}")
    v = call(base, f"/api/season/{sid}/recruiting")
    g = next(x for x in s["schedule"] if x["week"] == s["current_week"] + 1)
    hero = page.inner_text("#tab-office .ofc-hero")
    assert g["opponent_name"] in hero and s["team_name"].upper() in hero.upper(), hero
    label = s["week_labels"].get(str(g["week"])) or f"Week {g['week']}"
    assert label.upper() in page.inner_text("#tab-office .ofc-hero .go-kicker").upper()
    chip = page.inner_text("#tab-office .ofc-hero .ofc-chip")
    assert chip.upper() == {"home": "HOME GAME", "away": "AWAY GAME", "neutral": "NEUTRAL SITE"}[g["venue"]], chip
    win_chance(page)
    btn = page.query_selector("#tab-office .ofc-hero .go-play [data-play=gameday]")
    assert btn and btn.inner_text().startswith("Game Day"), "Game Day in the hero"
    # Program Pulse: the record and the AD's goal
    pulse = page.inner_text("#tab-office .ofc-pulse")
    rec = s["record"]
    assert f"{rec['wins']}-{rec['losses']}" in pulse and s["job"]["goal"] in pulse and s["job"]["mood"].upper() in pulse.upper(), pulse
    # Recruiting Pulse: real numbers
    rp = page.inner_text("#tab-office .ofc-recruit")
    assert f"{v['committed']} / {v['open_spots']}" in rp, rp
    assert f"{v['hours_left']} / {v['hours']}" in rp and f"{v['nil']['left']} / {v['nil']['budget']}" in rp, rp
    assert f"{v['points_left']} / {v['points_week']}" in rp, rp
    # Top Targets: the board's top with a standing chip and a Board link
    page.wait_for_selector("#tab-office .ofc-targets", timeout=30_000)
    rows = page.query_selector_all("#tab-office .ofc-target")
    want = v["targets"] or [b for b in v["board"] if not b.get("committed")][:4]
    assert len(rows) == min(4, len(want)), (len(rows), len(want))
    for r in rows:
        tag = r.query_selector(".go-tag").inner_text().strip()
        assert tag.upper() in ("YOURS", "FAVORITE", "IN IT", "LONG SHOT", "NOT OFFERED", "LOST"), tag
        assert "★" in r.inner_text() and "#" in r.inner_text()
    assert page.query_selector("#tab-office .ofc-targets button.go-link:has-text('Board →')")
    for sel in (".ofc-news", ".ofc-conf", ".ofc-plan"):
        assert page.query_selector(f"#tab-office {sel}"), sel


def check_layout(page, base, sid, theme) -> None:
    page.emulate_media(color_scheme=theme)
    page.set_viewport_size({"width": 1280, "height": 900})
    open_office(page, base, sid)
    assert columns(page) == 3, "three columns at 1280: Next Game two wide beside Program Pulse"
    # the rows line up: Next Game beside Program Pulse, This Week's Plan beside Recruiting Pulse, then News, the conference and Top Targets as one row
    rows = page.evaluate("() => ['.ofc-hero', '.ofc-pulse', '.ofc-row', '.ofc-recruit', '.ofc-news', '.ofc-conf', '.ofc-targets'].map(s => { const e = document.querySelector('#tab-office ' + s); return e ? Math.round(e.getBoundingClientRect().top) : null; })")
    assert rows[0] == rows[1] and rows[2] == rows[3] and rows[4] == rows[5] == rows[6], rows
    bars = page.evaluate("""() => [...document.querySelectorAll('#tab-office .go-card')].map(c => { const b = c.querySelector(':scope > .card-bar'); if (!b) return [c.className, null];
        const cs = getComputedStyle(b), r = b.getBoundingClientRect(), cr = c.getBoundingClientRect();
        return [c.className, Math.round(r.top - cr.top), Math.round(r.left - cr.left), cs.textTransform, cs.color, getComputedStyle(c).borderRadius]; })""")
    for b in bars:   # every card's header is its bar, flush with the card's top (inside its 1 px border), uppercase in the ink; square corners
        assert b[1] is not None, f"a card without a bar: {b[0]}"
        assert b[1] == 1 and b[2] == 1 and b[3] == "uppercase" and b[5] == "0px", b
    ink = page.evaluate("() => getComputedStyle(document.querySelector('#tab-office .ofc-pulse > .card-bar')).color")
    assert all(b[4] == ink for b in bars), "every bar's title reads in the one ink color"
    assert page.evaluate("() => getComputedStyle(document.querySelector('#tab-office .ofc-pulse > .card-bar')).backgroundColor") != page.evaluate("() => getComputedStyle(document.querySelector('#tab-office .ofc-pulse')).backgroundColor"), "the bar is the team's color on the card"

    clean(page)
    kickers_title_case(page)
    no_sideways(page)
    bg = page.evaluate("() => getComputedStyle(document.querySelector('#tab-office .ofc-pulse')).backgroundColor")
    assert bg != "rgba(0, 0, 0, 0)", "cards carry the theme's panel"
    page.set_viewport_size({"width": 400, "height": 860})
    time.sleep(0.4)
    assert columns(page) == 1, "one column on a phone"
    no_sideways(page)
    clean(page)
    small = page.evaluate("""() => [...document.querySelectorAll('#tab-office button')].filter(b => b.offsetParent && !b.classList.contains('go-link'))
        .map(b => [b.textContent.trim(), b.getBoundingClientRect().height]).filter(x => x[1] < 44)""")
    assert not small, f"phone controls under 44 px: {small}"
    rights = page.evaluate("() => [...document.querySelectorAll('#tab-office .go-card')].map(c => c.getBoundingClientRect().right)")
    assert all(r <= 400.5 for r in rights), rights
    page.set_viewport_size({"width": 1280, "height": 900})


def advance_week(base, sid) -> None:
    call(base, f"/api/season/{sid}/advance", {})
    wait_idle(base, sid)


def wait_idle(base, sid) -> None:
    for _ in range(600):
        if call(base, f"/api/season/{sid}/status").get("status") != "running":
            return
        time.sleep(0.5)
    raise AssertionError("the sim did not finish")


def check_plan_and_gameday(page, base, sid) -> None:
    """Recruit is current until you spend hours, then Game Day until the game is played, then Advance."""
    page.set_viewport_size({"width": 1280, "height": 900})
    call(base, f"/api/season/{sid}/settings", {"auto_recruit": "off"})
    open_office(page, base, sid)
    assert plan(page) == [["Recruit", "now"], ["Game Day", ""], ["Advance", ""]], plan(page)
    # spend hours: a message to a prospect on the board (or the class's top prospect, added first)
    v = call(base, f"/api/season/{sid}/recruiting")
    pid = v["board"][0]["id"] if v["board"] else call(base, f"/api/season/{sid}/prospects?limit=1")["rows"][0]["id"]
    if not v["board"]:
        call(base, f"/api/season/{sid}/board", {"pid": pid, "on": True})
    call(base, f"/api/season/{sid}/recruit", {"pid": pid, "action": "message", "pitch": "playing_time"})
    open_office(page, base, sid)
    assert plan(page) == [["Recruit", "part"], ["Game Day", "now"], ["Advance", ""]], plan(page)   # hours left: started, not ticked
    assert "left" in page.inner_text("#tab-office .ofc-step[data-step=recruit]"), "it says how many hours are left"
    # Game Day: the hero's button plays your game, drive by drive, as the play card's did
    week = call(base, f"/api/season/{sid}")["current_week"]
    page.click("#tab-office .ofc-hero .go-play [data-play=gameday]")
    page.wait_for_selector("#modal:not([hidden]), .gv-root, #gameview, .game-view", timeout=60_000)
    for _ in range(600):
        s = call(base, f"/api/season/{sid}")
        g = next(x for x in s["schedule"] if x["week"] == week + 1)
        if g["played"]:
            break
        time.sleep(0.5)
    assert g["played"] and s["current_week"] == week, "Game Day plays your game and only your game"
    wait_idle(base, sid)
    open_office(page, base, sid)
    assert plan(page) == [["Recruit", "part"], ["Game Day", "done"], ["Advance", "now"]], plan(page)
    hero = page.inner_text("#tab-office .ofc-hero")
    assert "FINAL" in hero.upper() and f"{g['points_for']}–{g['points_against']}" in hero and "NEXT GAME" not in hero.upper(), "this week's final leads until you advance"
    assert not page.query_selector("#tab-office .ofc-hero .go-play [data-play=gameday]"), "no Game Day once it is played"
    last = page.inner_text("#tab-office .go-game-last")
    assert f"{g['points_for']}–{g['points_against']}" in last, last
    stats = page.eval_on_selector_all("#tab-office .go-game-last .ofc-stat span", "els => els.map(e => e.textContent)")
    assert stats == ["Pass Yds", "Rush Yds", "TFL", "Sacks"], stats
    vals = page.eval_on_selector_all("#tab-office .go-game-last .ofc-stat b", "els => els.map(e => e.textContent)")
    assert all(re.fullmatch(r"\d+", x) for x in vals), vals
    box = call(base, f"/api/season/{sid}/game/{g['event_id']}")
    side = "home" if box["home_slug"] == s["team"] else "away"
    assert int(vals[0]) == box[side]["team_stats"]["Pass Yards"] and int(vals[1]) == box[side]["team_stats"]["Rush Yards"], (vals, box[side]["team_stats"])
    news = page.eval_on_selector_all("#tab-office .ofc-news li .ofc-when", "els => els.map(e => e.textContent)")
    assert news and all(re.fullmatch(r"This Week|Week \d+|.+", w) and "hour" not in w.lower() and "ago" not in w.lower() for w in news), news
    clean(page)
    call(base, f"/api/season/{sid}/settings", {"auto_recruit": "season"})


def check_bye(page, base, sid) -> None:
    open_office(page, base, sid)
    k = page.text_content("#tab-office .ofc-hero .go-kicker")
    assert k.startswith("Bye This Week"), k
    assert [p[0] for p in plan(page)] == ["Recruit", "Advance"], plan(page)
    assert not page.query_selector("#tab-office .ofc-odds"), "no Win Chance before game week"
    clean(page)


def check_done(page, base, sid) -> None:
    open_office(page, base, sid, ".ofc-hero.ofc-done")
    hero = page.inner_text("#tab-office .ofc-hero")
    assert "SEASON COMPLETE" in hero.upper() and "On to the Offseason" in hero, hero
    assert not page.query_selector("#tab-office .ofc-plan"), "no plan card once the season is over"
    clean(page)
    kickers_title_case(page)
    no_sideways(page)


if __name__ == "__main__":
    from sim import season
    import shutil
    import tempfile
    real_dir = season.SEASONS_DIR
    tmp = Path(tempfile.mkdtemp(prefix="cfp-office-read-"))
    season.SEASONS_DIR = tmp
    try:
        check_read()
    finally:
        season.close_pool()
        season.SEASONS_DIR = real_dir
        shutil.rmtree(tmp, ignore_errors=True)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("office redesign page test skipped: Playwright is not installed")
        raise SystemExit(0)
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    made = []
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(base + "/api/teams", timeout=2)
                break
            except OSError:
                time.sleep(0.5)
        # a career whose next week is a game, one whose next week is a bye, one finished
        probe = season.new_season("texas", "full", seed=5, career=True)
        week1 = {t for g in probe["games"].values() if g["week"] == 1 for t in (g["home"], g["away"])}
        teams = season.load_teams()
        fbs = sorted(t for t, d in teams.items() if not d["fictional"])
        play_team = next(t for t in ("georgia", "lsu", "alabama", "michigan", "clemson", "oregon", *fbs) if t in week1)
        bye_team = next(t for t in ("texas", "ohio-state", *fbs) if t not in week1)
        play = call(base, "/api/season", {"team": play_team, "seed": 5})["id"]
        made.append(play)
        bye = call(base, "/api/season", {"team": bye_team, "seed": 6})["id"]
        made.append(bye)
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"office redesign page test skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.dismiss())
            for theme in ("dark", "light"):
                check_layout(page, base, play, theme)
            page.emulate_media(color_scheme="dark")
            open_office(page, base, play)
            check_cards(page, base, play)
            check_bye(page, base, bye)
            check_plan_and_gameday(page, base, play)
            # the season over: sim to the end
            call(base, f"/api/season/{bye}/advance", {"to": 20})
            wait_idle(base, bye)
            for theme in ("dark", "light"):
                page.emulate_media(color_scheme=theme)
                for width in (1280, 400):
                    page.set_viewport_size({"width": width, "height": 900})
                    check_done(page, base, bye)
            browser.close()
        assert not errors, errors
        print("office redesign ok: the read; every card with real values at 1280 and 400 in both themes; Win Chance 1-99%; "
              "the plan after recruiting and after Game Day; a bye; the season over")
    finally:
        for sid in made:
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
        server.terminate()
