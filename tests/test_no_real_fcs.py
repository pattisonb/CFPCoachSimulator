"""No real FCS school is named anywhere a career shows games: the fictional stand-ins
(data/fcs_map.json maps every real FCS opponent on the 2026 schedules to one of eight) are
labeled "FCS <region>" on schedules, results, week lists, box scores and the next season's
schedule; the real names live only in the map and the strength tiers.

In the browser (Playwright with a Chromium; that part is skipped without one), a career saved before
the stand-ins were renamed (its slugs and names in the old style) opens with only "FCS <Region>"
showing for its FCS opponent: the Office's Next Game hero (names, the record line with no stray
separator, every team pill's title) and, once the game is played, its box score (header, line
score, kickoff line, injuries, scoring plays, the players tabs, every title attribute)."""
import json
import re
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import offseason
from sim import fcs_names
from sim import season
from test_offseason import finished

BAD = ("null", "undefined", "NaN")


def _page_names(page, where: str) -> tuple[str, list[str]]:
    """The text of `where` and every title and aria-label inside it (the modal's title bar too)."""
    text = page.inner_text(where)
    attrs = page.eval_on_selector_all(f"{where} [title], {where} [aria-label]",
                                      "els => els.flatMap(e => [e.getAttribute('title'), e.getAttribute('aria-label')]).filter(Boolean)")
    return text, attrs


def _assert_labels_only(page, where: str, fslug: str, what: str) -> None:
    label = season.fcs_label(fslug)
    text, attrs = _page_names(page, where)
    old = [k.lower() for k in fcs_names._table()[1]]      # case-insensitive: a heading may be in capitals
    for s in [text, *attrs]:
        hit = next((k for k in old if k in s.lower()), None)
        assert hit is None, f"{what}: an old stand-in name shows: {s[:300]}"
        for bad in BAD:
            assert bad not in s, f"{what}: {bad!r} on the page: {s[:300]}"
    assert label.lower() in text.lower(), f"{what}: {label} does not show: {text[:300]}"
    titles = page.eval_on_selector_all(f"{where} .team-pill", "els => els.map(e => e.getAttribute('title'))")
    assert label in titles and all(t and not t.startswith("FCS ") or t == label for t in titles), f"{what}: pill titles {titles}"


def browser_check() -> str:
    """The Office and a box score of an old-style save against an FCS stand-in, in a browser."""
    import os
    import subprocess
    import time
    import urllib.request
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return "browser part skipped: Playwright is not installed"
    from test_career_e2e import call, free_port, launch
    from test_no_standin_names import _old_style
    # a career one week before its game against a stand-in
    st = season.new_season("smu", "full", seed=5, career=True)
    me = st["team"]
    g = min((x for x in st["games"].values() if me in (x["home"], x["away"])
             and (season.state_fictional(x["home"]) or season.state_fictional(x["away"]))), key=lambda x: x["week"])
    fslug = g["home"] if season.state_fictional(g["home"]) else g["away"]
    if g["week"] > 1:
        season.advance_to(st, g["week"] - 1)
    path = season.save_season(st)
    path.write_text(_old_style(path.read_text(encoding="utf-8")), encoding="utf-8")       # saved before the rename
    assert fcs_names.has_old(path.read_text(encoding="utf-8"))
    sid = st["id"]
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    root = _Path(__file__).resolve().parents[1]
    server = subprocess.Popen([_sys.executable, "tools/dev_server.py"], cwd=root, env={**os.environ, "PORT": str(port)},
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
                return f"browser part skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})"
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/index.html?id={sid}&tab=office")
            page.wait_for_selector("#season:visible")
            page.wait_for_selector("#tab-office .go-game-next .go-side.theirs", timeout=120_000)
            time.sleep(0.8)
            _assert_labels_only(page, "#tab-office .go-game-next", fslug, "the Office's Next Game")
            sub = page.inner_text("#tab-office .go-game-next .go-side.theirs .ofc-team-sub").strip()
            assert sub and not sub.startswith("·") and not sub.endswith("·") and "· ·" not in sub, f"the stand-in's record line: {sub!r}"
            assert page.inner_text("#tab-office .go-game-next .go-side.theirs .ofc-team-name").strip().upper() == season.fcs_label(fslug).upper()
            # play the game, then open its box score
            call(base, f"/api/season/{sid}/advance", {"to": g["week"]})
            for _ in range(1200):
                if call(base, f"/api/season/{sid}/status?since=0")["status"] != "running" and call(base, f"/api/season/{sid}")["current_week"] >= g["week"]:
                    break
                time.sleep(0.5)
            assert call(base, f"/api/season/{sid}")["current_week"] == g["week"]
            page.goto(f"{base}/index.html?id={sid}&tab=schedule&modal=box:{g['event_id']}")
            page.wait_for_selector("#modal:not([hidden]) #sbox-score-row .team-block", timeout=120_000)
            time.sleep(0.5)
            _assert_labels_only(page, "#modal", fslug, "the box score")
            side = "home" if g["home"] == fslug else "away"
            tab = page.inner_text(f"#sbox-tabs button[data-btab={side}]")
            assert tab == f"{season.fcs_label(fslug)} players", tab
            browser.close()
        assert not errors, errors
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
    return f"the Office and the box score of an old save show only {season.fcs_label(fslug)}"


def real_fcs_names() -> list[str]:
    m = json.loads(season.FCS_MAP_FILE.read_text(encoding="utf-8"))
    teams = season.load_teams()
    fbs = {t["name"] for t in teams.values()} | {t.get("school") or "" for t in teams.values()}
    full = {v["name"] for v in m.values()} | {n for tier in season.FCS_TIERS.values() for n in tier}
    names = {n for n in full | {n.rsplit(" ", 1)[0] for n in full} if " " in n and n not in fbs and not any(n in f for f in fbs)}
    return sorted(names, key=len, reverse=True)


if __name__ == "__main__":
    names = real_fcs_names()
    assert len(names) > 100, len(names)
    pat = re.compile("(" + "|".join(re.escape(n) for n in names) + ")")
    found = {}

    def scan(obj, label):
        hits = sorted(set(pat.findall(json.dumps(obj))))
        if hits:
            found[label] = hits[:5]

    st = season.new_season("smu", "full", seed=3, career=True)
    season.advance_to(st, 3)
    fict = [g for g in st["games"].values() if season.state_fictional(g["home"]) or season.state_fictional(g["away"])]
    assert fict and all(g["home_display"].startswith("FCS") or g["away_display"].startswith("FCS") for g in fict), [(g["home_display"], g["away_display"]) for g in fict[:3]]
    scan(st["games"], "games"); scan(season.summary(st), "summary"); scan(season.standings(st), "standings")
    scan(season.team_schedule_view(st, "smu"), "my schedule")
    scan(season.team_schedule_view(st, fict[0]["home"] if season.state_fictional(fict[0]["home"]) else fict[0]["away"]), "fcs team schedule")
    for w in range(1, 21):
        scan(season.week_view(st, w), f"week {w}")
    played = next(g for g in fict if g["played"])
    scan(season.load_box(st, played["event_id"]) or {}, "box score")
    scan([t for t in season.load_teams().values() if t["fictional"]], "fictional teams")
    scan(season.schedule_options(season.new_season("smu", "full", seed=4, career=True), next(g["event_id"] for g in season.schedule_editable(season.new_season("smu", "full", seed=4, career=True)))), "trade options")
    # the next season's schedule keeps the stand-ins
    finished(st)
    offseason.run_all(st)
    new = offseason.next_season(st)
    fict2 = [g for g in new["games"].values() if season.state_fictional(g["home"]) or season.state_fictional(g["away"])]
    assert fict2 and all(g["home_display"].startswith("FCS") or g["away_display"].startswith("FCS") for g in fict2)
    scan(new["games"], "next season's games"); scan(season.team_schedule_view(new, "smu"), "next season's schedule")
    season.close_pool()
    assert not found, found
    ui = browser_check()
    season.close_pool()
    print(f"no real FCS names ok: {len(names)} names looked for across {len(fict)} FCS games, two seasons, box scores and week lists; {ui}")
