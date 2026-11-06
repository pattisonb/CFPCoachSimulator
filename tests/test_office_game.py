"""The Office shows the game (round 3, office-tips; the two-column redesign, web/office.js): before your game this week
the Next Game hero (both teams, ranks, records, the venue, the win chance); after a sim the Last Game card (W or L and
the final, the score by quarter, three or four leaders, Full Box Score opening the box-score modal with its box: token)
beside This Week's Plan, under the hero; a bye shows the next opponent; a one-line conference standing in Program Pulse
that matches the Standings tab ("SEC · 0-0" before any games). Your Program
leaves the Office for the League's Programs tab (the card and every program's table, open), which a reload restores.
Help lives in ⓘ tips: on a phone the Scouting Center's opens on a tap and closes on Escape, with no help line under the
title. The Stats roster reads the season's own roster (its overall is the depth chart's and the player page's) and its
cards name the number (OVR). A phone stacks the two game cards with no sideways scroll. Needs Playwright with a Chromium;
skipped without one. (Run as a file.)"""
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch, tab_click   # noqa: E402

BAD = ("null", "undefined", "NaN")


def ordinal(n: int) -> str:
    t, u = n % 100, n % 10
    return f"{n}{'th' if 10 < t < 14 else 'st' if u == 1 else 'nd' if u == 2 else 'rd' if u == 3 else 'th'}"


def open_tab(page, base, sid, tab, wait):
    page.goto(f"{base}/index.html?id={sid}&tab={tab}")
    page.wait_for_selector("#season:visible")
    page.wait_for_selector(wait, timeout=120_000)
    time.sleep(0.8)


def clean(page, where="#season") -> None:
    text = page.inner_text(where)
    for bad in BAD:
        assert bad not in text, f"{bad!r} on the page: {text[:400]}"


def want_standing(base, sid) -> str:
    s = call(base, f"/api/season/{sid}")
    rec = s["record"]
    short = {"American Athletic Conference": "American", "FBS Independent": "Independents"}.get(s["conference"], s["conference"])
    if not rec["wins"] + rec["losses"]:
        return f"{short} · 0-0"
    rows = call(base, f"/api/season/{sid}/standings")["standings"][s["conference"]]
    r = next(x for x in rows if x["slug"] == s["team"])
    if "independent" in s["conference"].lower():
        return f"{short} · {r['wins']}-{r['losses']}"
    div = f" {r['division']}" if r.get("division") else ""
    return f"{ordinal(r['conf_rank'])} in the {short}{div} · {r['conf_wins']}-{r['conf_losses']} {short}"


def standing_line(page) -> str:
    """Program Pulse's standing line, once the Office's read has filled it."""
    page.wait_for_function("() => (document.querySelector('#tab-office .ofc-pulse .go-standing-line') || {}).textContent", timeout=60_000)
    return page.inner_text("#tab-office .ofc-pulse .go-standing-line")


def check_upcoming(page, base, sid) -> None:
    page.set_viewport_size({"width": 1280, "height": 900})
    s = call(base, f"/api/season/{sid}")
    g = next(x for x in s["schedule"] if x["week"] == s["current_week"] + 1)
    open_tab(page, base, sid, "office", "#tab-office .ofc-hero")
    assert not page.query_selector("#tab-office .go-game-last"), "no Last Game before the first game"
    card = page.text_content("#tab-office .go-game-next")
    assert g["opponent_name"] in card and s["team_name"] in card, card
    assert page.get_attribute("#tab-office .go-game-next", "aria-label") == "Next Game"
    assert (s["week_labels"].get(str(g["week"])) or f"Week {g['week']}") in page.text_content("#tab-office .go-game-next .go-kicker")
    assert any(w in card for w in ("Home Game", "Away Game", "Neutral Site")), card
    page.wait_for_function("() => /Win Chance/i.test(document.querySelector('#tab-office .go-game-next .go-edge').textContent)", timeout=60_000)
    assert standing_line(page) == want_standing(base, sid), (standing_line(page), want_standing(base, sid))
    assert page.query_selector("#tab-office .go-game-next .go-play [data-play=gameday]"), "Game Day stays on the play card, in the hero"
    assert not page.query_selector("#tab-office .go-program"), "Your Program left the Office"
    clean(page)


def check_bye(page, base, sid) -> None:
    open_tab(page, base, sid, "office", "#tab-office .ofc-hero")
    s = call(base, f"/api/season/{sid}")
    nxt = next(x for x in s["schedule"] if x["opponent"] and not x["played"])
    k = page.text_content("#tab-office .go-game-next .go-kicker")
    assert k.startswith("Bye This Week · Next Game · ") and (s["week_labels"].get(str(nxt["week"])) or f"Week {nxt['week']}") in k, k
    assert nxt["opponent_name"] in page.text_content("#tab-office .go-game-next")


def check_no_game(page, base, sid) -> None:
    """Championship Week for a team not in a title game: the hero's kicker names the week and its date, never
    "Invalid Date" (the week's dates are a {start, end, main} record, not a date)."""
    open_tab(page, base, sid, "office", "#tab-office .ofc-hero")
    s = call(base, f"/api/season/{sid}")
    hero = page.text_content("#tab-office .go-game-next .ofc-hero-head .go-kicker")
    assert "No Game This Week" in page.text_content("#tab-office .go-game-next"), hero
    w = str(s["current_week"] + 1)
    assert "Invalid" not in hero and (s["week_labels"].get(w) or f"Week {w}") in hero, hero
    main = ((s.get("week_dates") or {}).get(w) or {}).get("main")
    assert main, w
    from datetime import date
    d = date.fromisoformat(main)
    assert d.strftime("%b") in hero and str(d.day) in hero, (hero, main)


def sim_week(page, base, sid) -> None:
    page.wait_for_selector("#tab-office .go-play [data-play=advance]:not([disabled])", timeout=60_000)
    page.click("#tab-office .go-play [data-play=advance]")
    page.wait_for_function("() => document.body.classList.contains('simming')", timeout=10_000)
    page.wait_for_function("() => !document.body.classList.contains('simming')", timeout=600_000)
    page.wait_for_selector("#tab-office .go-game-last .go-leaders li", timeout=120_000)
    time.sleep(1.0)


def check_selected(page, base, sid) -> None:
    """Championship Week played: the bracket is built and the bowls are picked, so the Office can already name your
    next game. The Bracket and Bowls tabs open with it (never a bowl in the Office with no Bowls tab to see)."""
    open_tab(page, base, sid, "office", "#tab-office .ofc-hero")
    s = call(base, f"/api/season/{sid}")
    assert s["bracket"] and s["bowls"], "the bracket and the bowls are set once Championship Week is played"
    hid = page.evaluate("() => ['bracket', 'bowls'].map(t => document.querySelector(`#season-tabs button[data-tab=${t}]`).hidden)")
    assert hid == [False, False], f"Bracket and Bowls tabs hidden after Championship Week: {hid}"
    nxt = next((x for x in s["schedule"] if x["opponent"] and not x["played"]), None)
    if nxt:   # your bowl or playoff game is in the Office; the Bowls tab has the real lineup, not a projection
        assert nxt["opponent_name"] in page.text_content("#tab-office .go-game-next")
    open_tab(page, base, sid, "bowls", "#tab-bowls h3")
    assert "Projected" not in page.text_content("#tab-bowls h3"), page.text_content("#tab-bowls h3")
    clean(page)


def check_played(page, base, sid) -> None:
    s = call(base, f"/api/season/{sid}")
    last = [x for x in s["schedule"] if x["played"] and x["opponent"]][-1]
    head = page.inner_text("#tab-office .go-game-last .go-final")
    assert ("W" if last["won"] else "L") in head and f"{last['points_for']}–{last['points_against']}" in head, head
    q = page.eval_on_selector_all("#tab-office .go-quarters tbody tr", "rs => rs.map(r => [...r.querySelectorAll('td')].map(t => t.textContent))")
    box = call(base, f"/api/season/{sid}/game/{last['event_id']}")
    assert q[0][:4] == [str(x) for x in box["away"]["quarters"][:4]] and q[1][-1] == str(box["home"]["score"]), (q, box["away"]["quarters"])
    leaders = page.eval_on_selector_all("#tab-office .go-leaders li .go-kicker", "els => els.map(e => e.textContent)")
    assert 3 <= len(leaders) <= 4 and leaders[:3] == ["Passing", "Rushing", "Receiving"], leaders
    # the hero above, Last Game beside This Week's Plan under it on a desktop
    assert page.query_selector("#tab-office .go-game-next"), "the Next Game hero stays"
    r = page.evaluate("() => ['.go-game-next', '.go-game-last', '.ofc-plan'].map(s => document.querySelector('#tab-office ' + s).getBoundingClientRect()).map(b => [b.top, b.bottom])")
    assert r[1][0] >= r[0][1] - 0.5 and abs(r[1][0] - r[2][0]) < 2, f"Last Game beside the plan, under the hero: {r}"
    # the standing line is the Standings tab's place and record
    want = want_standing(base, sid)
    assert standing_line(page) == want, (standing_line(page), want)
    clean(page)
    # Full Box Score: the existing modal, its box: token in the address
    page.click("#tab-office .go-full-box")
    page.wait_for_selector("#modal:not([hidden]) #sbox-score-row .team-block", timeout=60_000)
    assert f"box:{last['event_id']}" in page.evaluate("() => new URLSearchParams(location.search).getAll('modal').join(',')")
    page.keyboard.press("Escape")
    page.wait_for_selector("#modal", state="hidden", timeout=10_000)
    # the Standings tab says the same
    tab_click(page, "standings")
    page.wait_for_selector("#tab-standings tr.mine", timeout=60_000)
    row = page.eval_on_selector("#tab-standings tr.mine", "r => [...r.querySelectorAll('td')].map(t => t.textContent)")
    if want != "0-0" and " in the " in want:
        assert row[0] == want.split(" in the ")[0].rstrip("stndrh"), (row, want)


def check_phone(page, base, sid) -> None:
    page.set_viewport_size({"width": 400, "height": 860})
    open_tab(page, base, sid, "office", "#tab-office .go-game-last .go-leaders li")
    r = page.evaluate("() => ['.go-game-next', '.go-game-last'].map(s => document.querySelector('#tab-office ' + s).getBoundingClientRect()).map(b => [b.top, b.bottom, b.right])")
    assert len(r) == 2 and r[1][0] >= r[0][1] - 0.5, f"a phone stacks the cards: {r}"
    assert all(x[2] <= 400.5 for x in r), r
    assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways scroll on the Office"
    h = page.evaluate("() => document.querySelector('#tab-office .go-full-box').getBoundingClientRect().height")
    assert h >= 44, f"Full Box Score is a 44 px target: {h}"
    page.set_viewport_size({"width": 1280, "height": 900})


def check_programs(page, base, sid) -> None:
    open_tab(page, base, sid, "programs", "#tab-programs .go-programs tbody tr")
    assert page.is_visible("#tab-programs .go-program .go-program-bars"), "Your Program's bars"
    assert page.is_visible("#tab-programs .go-programs"), "every program, open"
    assert page.inner_text("#season-tabs button[data-tab=programs]") .strip().lower() == "programs"
    assert page.query_selector("#tab-programs .go-programs tr.mine"), "your row is marked"
    assert page.query_selector("#tab-programs .go-job"), "the AD's goal sits with the program"
    page.reload()
    page.wait_for_selector("#tab-programs .go-programs tbody tr", timeout=120_000)
    assert page.evaluate("() => new URLSearchParams(location.search).get('tab')") == "programs"
    assert not page.is_hidden("#tab-programs"), "a reload lands on Programs"
    clean(page)
    tab_click(page, "office")
    page.wait_for_selector("#tab-office .ofc-hero", timeout=60_000)
    assert not page.query_selector("#tab-office .go-program"), "no program card on the Office"


def check_tip(page, base, sid) -> None:
    page.set_viewport_size({"width": 400, "height": 860})
    open_tab(page, base, sid, "scouting", ".sc-list .sc-row")
    assert not page.query_selector(".sc-head-text p"), "no help line under the Scouting Center title"
    btn = page.query_selector(".sc-head .go-info")
    assert btn.get_attribute("aria-label") == "About Scouting Center"
    tip_id = btn.get_attribute("aria-describedby")
    assert tip_id and "three looks" in page.text_content(f"#{tip_id}")
    assert btn.bounding_box()["height"] >= 44 and btn.bounding_box()["width"] >= 44, btn.bounding_box()
    btn.click()                                     # a tap: the click a phone sends
    page.wait_for_selector(f"#{tip_id}.show", timeout=5_000)
    box = page.eval_on_selector(f"#{tip_id}", "b => { const r = b.getBoundingClientRect(); return [r.left, r.right]; }")
    assert box[0] >= 0 and box[1] <= 400.5, f"the tip stays on screen: {box}"
    page.keyboard.press("Escape")
    page.wait_for_selector(f"#{tip_id}:not(.show)", state="attached", timeout=5_000)
    assert not page.is_visible(f"#{tip_id}")
    # a tap outside closes it too
    btn.click()
    page.wait_for_selector(f"#{tip_id}.show", timeout=5_000)
    page.mouse.click(200, 820)
    time.sleep(0.2)
    assert not page.is_visible(f"#{tip_id}"), "a tap outside closes the tip"
    page.set_viewport_size({"width": 1280, "height": 900})


def check_roster(page, base, sid) -> None:
    s = call(base, f"/api/season/{sid}")
    team = s["team"]
    depth = call(base, f"/api/season/{sid}/depth/{team}/roster")["players"]
    qbs = {p["name"]: p["overall"] for p in depth if p["position"] == "QB"}
    page.goto(f"{base}/index.html?id={sid}&tab=stats&steam={team}&sview=roster")
    page.wait_for_selector(".roster-grid .leader-card", timeout=120_000)
    time.sleep(0.5)
    card = page.query_selector(".roster-grid .leader-card:has(h4:text-is('QB'))") or page.query_selector(".roster-grid .leader-card")
    assert "OVR" in card.inner_text(), "the card names the number"
    assert card.query_selector(".roster-ovr-head .go-info"), "with an ⓘ"
    rows = card.eval_on_selector_all(".leader-row", "rs => rs.map(r => [r.querySelector('.name span').textContent, r.querySelector('.value').textContent])")
    assert rows, "QB rows"
    for name, val in rows:
        assert name in qbs and int(val) == qbs[name], f"{name}: the roster shows {val}, the depth chart {qbs.get(name)}"
    # the player page says the same
    name = rows[0][0]
    card.query_selector(".leader-row .name span[data-player]").click()
    page.wait_for_selector("#modal:not([hidden]) .player-ovr-num", timeout=60_000)
    assert int(page.inner_text("#modal .player-ovr-num")) == qbs[name], (page.inner_text("#modal .player-ovr-num"), qbs[name])
    page.keyboard.press("Escape")


def pick_team(season):
    """A career whose week-1 date is a game (the upcoming card), and one whose week 1 is a bye."""
    teams = season.load_teams()
    probe = season.new_season("texas", "full", seed=5, career=True)
    week1 = {t for g in probe["games"].values() if g["week"] == 1 for t in (g["home"], g["away"])}
    fbs = sorted(t for t, d in teams.items() if not d["fictional"])
    play = next(t for t in ("georgia", "lsu", "alabama", "michigan", "clemson", "oregon", *fbs) if t in week1 and t in teams)
    bye = next(t for t in ("texas", "ohio-state", *fbs) if t not in week1)
    return season.new_season(play, "full", seed=5, career=True), season.new_season(bye, "full", seed=6, career=True)


def pick_done(season):
    """A career at Championship Week whose team is not in a title game (no game of its own this week)."""
    for slug in ("rice", "kent-state", "akron", "umass", "kennesaw-state"):
        st = season.new_season(slug, "full", seed=7, career=True)
        season.advance_to(st, season.CCG_WEEK - 1)
        if not any(g["week"] == season.CCG_WEEK and slug in (g["home"], g["away"]) for g in st["games"].values()):
            return st
    raise AssertionError("every probe team made its conference title game")


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("office game test skipped: Playwright is not installed")
        raise SystemExit(0)
    from sim import season
    play, bye = pick_team(season)
    assert play and bye, "a team with a week-1 game and one with a week-1 bye"
    season.save_season(play)
    season.save_season(bye)
    done = pick_done(season)
    season.save_season(done)
    selected = season.new_season("rice", "full", seed=7, career=True)   # Championship Week played: the field is set
    season.advance_to(selected, season.CCG_WEEK)
    season.save_season(selected)
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
                print(f"office game test skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.dismiss())
            check_upcoming(page, base, play["id"])
            check_bye(page, base, bye["id"])
            check_no_game(page, base, done["id"])
            check_selected(page, base, selected["id"])
            check_roster(page, base, play["id"])
            check_tip(page, base, play["id"])
            open_tab(page, base, play["id"], "office", "#tab-office .ofc-hero")
            sim_week(page, base, play["id"])
            check_played(page, base, play["id"])
            check_phone(page, base, play["id"])
            check_programs(page, base, play["id"])
            browser.close()
        assert not errors, errors
        print("office game ok: Next Game before, Last Game beside the plan under the Next Game hero after a sim (quarters, leaders, Full Box Score), a bye's next "
              "opponent, the standing line, the Programs tab (and a reload), the Scouting ⓘ on a phone, the roster's OVR")
    finally:
        for sid in (play["id"], bye["id"], done["id"], selected["id"]):
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
        server.terminate()
