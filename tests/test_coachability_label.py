"""Your players show their Coachability, not EA's development trait (season.development_reads): every
generated player carries a placeholder "Normal" trait, so by a career's fourth year a roster read
"Normal Development" from top to bottom. The player page and the depth chart now show each of your
own players' true coachability in the game's own six words (recruits.COACHABILITY, the words the
scouting reads use) and his potential in the scouting report's Potential words; nobody else's roster
shows either (a future portal entrant's coachability stays a read). After an offseason the roster
still reads several words, and the league's mix stays at the levels' shares. In a browser at 1280
and 400 wide: the player page's tag, the depth chart's drawer and card, and no null, undefined or
NaN anywhere. Needs Playwright with a Chromium for the browser part; without one that part is
skipped with the reason. (Run as a file: multiprocessing on Windows.)"""
import collections
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

from coach_career import offseason, recruiting, recruits   # noqa: E402
from sim import season   # noqa: E402
from test_offseason import finished   # noqa: E402

LEVELS = [n for n, _, _ in recruits.COACHABILITY]
SHARES = {n: s for n, _, s in recruits.COACHABILITY}
TEAM = "ohio-state"
LEAKS = re.compile(r"\b(undefined|null|NaN)\b")
OLD = re.compile(r"Normal Dev|Development: Normal|Normal Development|\b(Impact|Star|Elite) Dev(elopment)?\b")
SHOWN = re.compile(r"Coachability:?\s*(" + "|".join(re.escape(w) for w in LEVELS) + r")")


def check_reads(st: dict, label: str) -> collections.Counter:
    """Your roster: every player has a level from the scale and a Potential word; anyone else's: nothing."""
    reads = season.development_reads(st, TEAM)
    roster = season.load_teams()[TEAM]
    slugs = [p["slug"] for p in roster["offense"] + roster["defense"]]
    assert len(reads) >= 0.9 * len(slugs), (label, len(reads), len(slugs))
    for slug, r in reads.items():
        assert r["coachability"] in LEVELS and r["coach_level"] == LEVELS.index(r["coachability"]) + 1, (label, slug, r)
        from coach_career import clear
        pw = r.get("potential_word")
        assert (pw is not None and pw.isdigit() and 1 <= int(pw) <= 99) if clear.on() else pw in recruiting.WORDS, (label, slug, r)   # Clear Mode: the number
    other = "michigan"
    assert season.development_reads(st, other) == {}, "another team's coachability leaked"
    them = season.load_teams()[other]
    q = (them["offense"] + them["defense"])[0]
    prof = season.player_profile(st, other, slug=q["slug"])
    assert "coachability" not in prof and "potential_word" not in prof, "another team's player page leaked his coachability"
    chart = season.depth_chart_view(st, other)
    assert not any("coachability" in p for u in chart["units"] for r in u["rows"] for p in r["players"])
    # yours: the player page, the chart's cards and the position list carry it; the old trait is not sent to the chart
    mine = season.depth_chart_view(st, TEAM)
    cards = [p for u in mine["units"] for r in u["rows"] for p in r["players"]]
    assert all(p.get("coachability") in LEVELS for p in cards if p["slug"] in reads), label
    assert not any("dev_trait" in p for p in cards), "the depth chart still sends the development trait"
    cand = season.position_candidates(st, TEAM, "QB")["players"]
    assert all(p.get("coachability") in LEVELS for p in cand if p["slug"] in reads) and not any("dev_trait" in p for p in cand)
    slug = next(iter(reads))
    prof = season.player_profile(st, TEAM, slug=slug)
    assert prof["coachability"] == reads[slug]["coachability"] and prof["potential_word"] == reads[slug]["potential_word"]
    words = collections.Counter(r["coachability"] for r in reads.values())
    assert len(words) >= 3, (label, words)
    return words


def check_league_mix(st: dict) -> dict:
    """The whole league after offseasons: every level present, each near its share (recruits.COACHABILITY)."""
    lg = st["league"]
    c = collections.Counter(p.get("c") for t in lg["teams"].values() for p in t["roster"])
    n = sum(c.values())
    assert set(c) <= set(LEVELS), c
    for name, share in SHARES.items():
        assert abs(c[name] / n - share) <= max(0.04, share * 0.5), (name, c[name] / n, share)
    fresh = collections.Counter(p.get("c") for t in lg["teams"].values() for p in t["roster"] if p.get("cls") == "FR")
    assert len(fresh) == len(LEVELS), f"the signed freshmen do not span the scale: {fresh}"
    return {k: round(v / n, 3) for k, v in c.most_common()}


def browser_checks(fresh: dict, later: dict) -> str:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return "browser part skipped: Playwright is not installed"
    from test_career_e2e import call, free_port, launch
    season.save_season(fresh)
    season.save_season(later)
    season.use_league(None)
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port), "CFP_QUESTION_RATE": "0"},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(240):
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
            seen = set()
            for sid in (fresh["id"], later["id"]):
                roster = call(base, f"/api/season/{sid}/depth/{TEAM}/roster")["players"]
                api_words = collections.Counter(r.get("coachability") for r in roster)
                assert None not in api_words and len(api_words) >= 3, api_words
                for width in (1280, 400):
                    page = browser.new_page(viewport={"width": width, "height": 900})
                    errors = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    page.on("dialog", lambda d: d.dismiss())
                    # the player page: "Coachability: <word>" and "Potential: <word>" tags, no development trait
                    pl = roster[0]
                    token = f"player:{TEAM}|{pl['name']}|{pl['position']}"
                    page.goto(f"{base}/index.html?" + urllib.parse.urlencode([("id", sid), ("modal", token)]))
                    page.wait_for_selector(".modal:not([hidden]) .player-page .player-dev", timeout=120_000)
                    dev = page.inner_text(".modal:not([hidden]) .player-dev")
                    m = SHOWN.search(dev)
                    assert m and m.group(1) == pl["coachability"], (width, dev, pl["coachability"])
                    assert re.search(r"Potential:?\s*(" + "|".join(recruiting.WORDS) + r"|\d{1,2})", dev), dev   # Clear Mode: the number
                    tip = page.get_attribute(".modal:not([hidden]) .player-dev .tag.dev", "title")
                    assert tip and tip[0].isupper() and tip.endswith("."), tip
                    body = page.inner_text(".modal:not([hidden])")
                    assert not OLD.search(body) and "Development" not in body, OLD.search(body) or "Development"
                    assert not LEAKS.search(body), LEAKS.search(body).group(0)
                    # the edit form (god mode) has no dead Development field
                    assert not page.query_selector(".modal:not([hidden]) select[aria-label=dev_trait]")
                    # the depth chart's Players screen: each card's "Coachability: <word>" tag, several words over the roster
                    page.goto(f"{base}/index.html?" + urllib.parse.urlencode([("id", sid), ("screen", "depth"), ("sub", "players")]))
                    page.wait_for_selector("#depth-screen:not([hidden]) .dc-tile", timeout=120_000)
                    words = set()
                    for i in range(6):
                        tile = page.query_selector_all("#depth-screen .dc-tile")[i * 7]
                        slug = tile.get_attribute("data-slug")
                        tile.click()
                        page.wait_for_function("(s) => { const c = document.querySelector('#depth-screen .dc-pc-tags'); return c && c.closest('[data-slug]') && c.closest('[data-slug]').dataset.slug === s; }",
                                               arg=slug, timeout=30_000)
                        tags = page.inner_text("#depth-screen .dc-pc-tags")
                        m = SHOWN.search(tags)
                        assert m, (width, tags)
                        words.add(m.group(1))
                        assert not OLD.search(tags), tags
                    assert len(words) >= 2, (width, words)
                    seen |= words
                    # the formation's drawer: the Coachability and Potential stats
                    page.goto(f"{base}/index.html?" + urllib.parse.urlencode([("id", sid), ("screen", "depth")]))
                    page.wait_for_selector("#depth-screen:not([hidden]) .dc-card", timeout=120_000)
                    page.click("#depth-screen .dc-card >> nth=0")
                    page.wait_for_selector("#depth-screen .dc-drawer", timeout=30_000)
                    drawer = page.inner_text("#depth-screen .dc-drawer")
                    assert re.search(r"Coachability\s*(" + "|".join(re.escape(w) for w in LEVELS) + ")", drawer, re.I), drawer
                    assert "Development" not in drawer and not LEAKS.search(drawer), drawer
                    whole = page.inner_text("body")
                    assert not OLD.search(whole) and not LEAKS.search(whole), OLD.search(whole) or LEAKS.search(whole).group(0)
                    assert not errors, errors
                    page.close()
            browser.close()
        return f"browser ok at 1280 and 400: the player page, the depth chart's cards and drawer; words seen {sorted(seen)}"
    finally:
        for sid in (fresh["id"], later["id"]):
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001
                pass
            (season.SEASONS_DIR / f"{sid}.json").unlink(missing_ok=True)
        server.terminate()


if __name__ == "__main__":
    from coach_career import league
    fresh = season.new_season(TEAM, "full", seed=31, career=True)
    first = check_reads(fresh, "2026")
    st = season.new_season(TEAM, "full", seed=32, career=True)
    sid = st["id"]
    for _ in range(2):                       # two offseasons: real players leave, generated ones arrive
        finished(st)
        offseason.run_all(st)
        st = offseason.next_season(st)
    later = check_reads(st, "2028")
    mix = check_league_mix(st)
    note = browser_checks(fresh, st)
    for y in range(2026, 2031):
        p = league.path(sid, y)
        if p.exists():
            p.unlink()
    league.forget(sid)
    season.use_league(None)
    season.close_pool()
    print(f"coachability label ok: 2026 roster {dict(first)}; 2028 roster {dict(later)}; league {mix}; {note}")
