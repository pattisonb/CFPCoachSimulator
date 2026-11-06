"""The Season Recap (web/recap.js, the Summary tab reborn) and the Awards overview (web/season.js renderAwards),
in a browser at 1280 and 400 px, dark and light.

The grade (sim/grade.py): a pure function of the state, no randomness, A+ for a champion only, every band's
verdict a sentence. The review API carries the grade once the season is done, the title game's seeds and
records, the non-conference record and your total offense, total defense and turnover margin with their ranks.

The page: before the season ends the header reads "Season So Far" with no grade, and the Awards overview is the
live race ("Leader"); when the title game is played the game lands on the Season Recap, which shows the champion
with the box-score link, the four playoff rounds, the Heisman, the grade and its verdict, the Your Season tiles,
the highlights (their box scores open), the biggest surprise and disappointment and the national leaders;
"Back to the Office" goes to the Office. The Awards overview shows the Heisman hero, the award cards, your team's
podium and the consensus All-America team; a filter chip patches the card grid in place. Nowhere an FCS stand-in's
old name, a null, a label out of Title Case, a sideways scroll, or a card out of line with its row. Needs Playwright
with a Chromium; skipped without one. (Run as a file: multiprocessing on Windows.)"""
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

from test_career_e2e import call, free_port, launch, tab_click   # noqa: E402
from test_no_standin_names import PATTERN as STAND_IN   # noqa: E402

LEAKS = re.compile(r"\b(undefined|null|NaN)\b")
SMALL = {"a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by", "vs"}
SHOTS = os.environ.get("RECAP_SHOTS")      # a folder: screenshots of both screens at both widths and themes


# ----- the grade, in process ------------------------------------------------------------------------------

def check_grade() -> None:
    from coach_career import carousel
    from sim import grade, season
    from test_offseason import finished
    st = season.new_season("ohio-state", "full", seed=8, career=True)
    finished(st)
    before = json.dumps(st, sort_keys=True, default=str)
    g = grade.season_grade(st)
    assert json.dumps(st, sort_keys=True, default=str) == before, "the grade changes nothing"
    assert g == grade.season_grade(st), "no randomness"
    assert g["grade"] == "A+" and g["band"] == "champion", g          # finished() crowns Ohio State
    assert g["line"][0].isupper() and g["line"].endswith("."), g["line"]
    for band, line in grade.GRADE_LINES.items():
        text = line.format(record="9-4", goal="win nine games", round="the semifinals")
        assert text[0].isupper() and text.endswith(".") and "{" not in text, (band, text)
    # a losing season at a Blue Blood: an F and the fired-level line
    st2 = season.new_season("ohio-state", "full", seed=8, career=True)
    finished(st2)
    st2["champion"] = "texas"
    for g2 in st2["games"].values():
        if "ohio-state" in (g2["home"], g2["away"]) and g2["kind"] == "regular":
            g2["home_score"], g2["away_score"] = (0, 21) if g2["home"] == "ohio-state" else (21, 0)
    g = grade.season_grade(st2)
    assert g["grade"] == "F" and g["band"] == "fired", g
    assert carousel.goal("ohio-state", st2)["text"] == g["goal"]
    r = season.season_review(st2)
    assert r["grade"]["grade"] == "F" and r["year"] == 2026 and r["mine"]["non_conf_wins"] + r["mine"]["non_conf_losses"] >= 2, r["mine"]
    assert isinstance(r["mine"]["wins_short"], int)
    print("  grade ok:", grade.season_grade(st)["grade"], "for the champion, F for the losing season")


# ----- the page ----------------------------------------------------------------------------------------------

def title_case(text: str) -> bool:
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


def advance_to(base, sid, week) -> None:
    """Sim to a week through the API and wait for it: the job starts a moment after the call answers, so the
    wait is for the week, not for the first idle status."""
    call(base, f"/api/season/{sid}/advance", {"to": week})
    reached, idle = None, 0
    for _ in range(2400):
        time.sleep(0.5)
        if call(base, f"/api/season/{sid}/status?since=0")["status"] == "running":
            idle = 0
            continue
        reached = call(base, f"/api/season/{sid}")["current_week"]
        if reached == week:
            return
        idle += 1
        if idle >= 10:                      # five seconds idle short of the week: the sim stopped
            break
    raise AssertionError(f"the sim stopped at week {reached}, not {week}")


def clean(page, root: str, errors) -> None:
    assert not errors, errors
    text = page.inner_text(root)
    assert not LEAKS.search(text), LEAKS.search(text).group(0)
    assert not STAND_IN.search(text), STAND_IN.search(text).group(0)


def labels_title_case(page, root: str) -> None:
    labels = page.eval_on_selector_all(
        f"{root} .go-kicker, {root} .go-tag, {root} .go-chip, {root} button.go-btn, {root} .rcp-link, {root} th, {root} .rcp-snap span, "
        f"{root} .rcp-tile span, {root} .aw-pod span, {root} .go-seg-btn, {root} .rcp-hl-k, {root} .aw-unan, {root} .rcp-h1",
        "els => els.filter(e => e.offsetParent).map(e => e.textContent.trim()).filter(Boolean)")
    bad = [t for t in labels if not title_case(t)]
    assert not bad, f"labels not in Title Case: {bad}"


def no_sideways(page) -> None:
    assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "sideways scroll"


def aligned(page, root: str) -> None:
    """Cards in a row share their top and bottom; a column's cards share left and right; nothing pokes out of its parent."""
    bad = page.evaluate("""(root) => {
      const out = [], r = (e) => e.getBoundingClientRect();
      for (const row of document.querySelectorAll(`${root} .rcp-row, ${root} .rcp-main, ${root} .aw-main, ${root} .rcp-tiles, ${root} .aw-pod, ${root} .rcp-snap`)) {
        const kids = [...row.children].filter(k => k.offsetParent);
        if (kids.length < 2) continue;
        const cols = getComputedStyle(row).gridTemplateColumns.split(' ').length;
        if (cols < 2) continue;
        kids.splice(cols);                                   // the first row of a grid that wraps (a lone third tile spans its row)
        const tops = kids.map(k => Math.round(r(k).top)), bottoms = kids.map(k => Math.round(r(k).bottom));
        if (Math.max(...tops) - Math.min(...tops) > 1) out.push(['tops', row.className, tops]);
        if (row.classList.contains('rcp-row') || row.classList.contains('rcp-tiles') || row.classList.contains('aw-pod'))
          if (Math.max(...bottoms) - Math.min(...bottoms) > 1) out.push(['bottoms', row.className, bottoms]);
      }
      for (const col of document.querySelectorAll(`${root} .rcp-col, ${root} .aw-col`)) {
        const kids = [...col.children].filter(k => k.offsetParent && !k.classList.contains('rcp-rivalries'));
        const lefts = kids.map(k => Math.round(r(k).left)), rights = kids.map(k => Math.round(r(k).right));
        if (kids.length && (Math.max(...lefts) - Math.min(...lefts) > 1 || Math.max(...rights) - Math.min(...rights) > 1)) out.push(['column', col.className, lefts, rights]);
      }
      for (const c of document.querySelectorAll(`${root} .rcp-card, ${root} .aw-card, ${root} .rcp-tile, ${root} .aw-row, ${root} .rcp-round`)) {
        if (!c.offsetParent) continue;
        const a = r(c), p = r(c.parentElement);
        if (a.right > p.right + 1 || a.left < p.left - 1 || c.scrollWidth > c.clientWidth + 1) out.push(['overflow', c.className, Math.round(a.right), Math.round(p.right)]);
      }
      return out; }""", root)
    assert not bad, bad


def shoot(page, name: str) -> None:
    if not SHOTS:
        return
    Path(SHOTS).mkdir(parents=True, exist_ok=True)
    page.evaluate("() => window.scrollTo(0, 0)")
    for theme in ("dark", "light"):
        page.evaluate("(t) => { document.documentElement.dataset.theme = t; }", theme)
        time.sleep(0.2)
        page.screenshot(path=str(Path(SHOTS) / f"{name}-{theme}.png"), full_page=True)
    page.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }")


def both_widths(page, root: str, name: str, check=None) -> None:
    for width in (1280, 400):
        page.set_viewport_size({"width": width, "height": 900 if width > 600 else 860})
        time.sleep(0.5)
        no_sideways(page)
        aligned(page, root)
        labels_title_case(page, root)
        if check:
            check(width)
        if width == 400:
            small = page.evaluate(f"""() => [...document.querySelectorAll('{root} button')].filter(b => b.offsetParent)
                .map(b => [b.textContent.trim().slice(0, 30), b.getBoundingClientRect().height]).filter(x => x[1] < 43.5)""")
            assert not small, f"phone controls under 44 px: {small}"
        shoot(page, f"{name}-{width}")
    page.set_viewport_size({"width": 1280, "height": 900})


def open_recap(page, base, sid) -> None:
    page.goto(f"{base}/index.html?id={sid}&tab=summary")
    page.wait_for_selector("#season:visible", timeout=120_000)
    page.wait_for_selector("#tab-summary .rcp-main", timeout=120_000)
    page.wait_for_function("() => !document.querySelector('#tab-summary .go-loading')", timeout=60_000)
    time.sleep(0.6)


def open_awards(page, base, sid) -> None:
    page.goto(f"{base}/index.html?id={sid}&tab=awards")
    page.wait_for_selector("#season:visible", timeout=120_000)
    page.wait_for_selector("#tab-awards .aw-main", timeout=120_000)
    time.sleep(0.6)


def check_live(page, base, sid, errors) -> None:
    """Mid-season: Season So Far, no grade; the Awards overview is the live race."""
    open_recap(page, base, sid)
    head = page.inner_text("#tab-summary .rcp-head")
    assert "SEASON SO FAR" in head.upper() and "SEASON GRADE" not in head.upper(), head
    assert not page.query_selector("#tab-summary .rcp-acts button:has-text('Start the Offseason')")
    assert "NOT DECIDED YET" in page.inner_text("#tab-summary .rcp-champ").upper()
    clean(page, "#tab-summary", errors)
    both_widths(page, "#tab-summary", "recap-live")
    open_awards(page, base, sid)
    assert page.query_selector("#tab-awards .aw-views .go-chip.on:has-text('Overview')"), "the Overview chip is on"
    tags = page.eval_on_selector_all("#tab-awards .aw-card .go-tag", "els => els.map(e => e.textContent.trim())")
    assert tags and all(t == "Leader" for t in tags), tags
    assert "STRAW POLL" in page.inner_text("#tab-awards .aw-heis").upper()
    clean(page, "#tab-awards", errors)
    both_widths(page, "#tab-awards", "awards-live")


def check_landing(page, base, sid) -> None:
    """The last week simmed from the Office: the Season Recap lands."""
    page.goto(f"{base}/index.html?id={sid}&tab=office")
    page.wait_for_selector("#season:visible", timeout=120_000)
    page.wait_for_selector("#tab-office .go-play [data-play=advance]", timeout=120_000)
    page.click("#tab-office .go-play [data-play=advance]")
    page.wait_for_selector("#tab-summary:not([hidden]) .rcp-head", timeout=900_000)
    page.wait_for_function("() => /tab=summary/.test(location.search)", timeout=30_000)
    assert call(base, f"/api/season/{sid}")["done"]


def check_recap(page, base, sid, errors) -> None:
    s = call(base, f"/api/season/{sid}")
    r = call(base, f"/api/season/{sid}/review")
    assert r["done"] and r["grade"] and r["title_game"]["played"]
    open_recap(page, base, sid)
    head = page.inner_text("#tab-summary .rcp-head")
    assert "SEASON RECAP" in head.upper() and f"{r['year']} SEASON COMPLETE" in head.upper(), head
    m = r["mine"]
    assert f"{m['wins']}-{m['losses']}" in head and r["grade"]["grade"] in head and r["grade"]["line"] in head, head
    assert page.query_selector("#tab-summary .rcp-acts button.primary:has-text('Start the Offseason')")
    # the champion and the title game
    champ = page.inner_text("#tab-summary .rcp-champ")
    assert r["champion_name"] in champ and str(r["title_game"]["home_score"]) in champ and r["title_game"]["site"] in champ, champ
    assert r["title_game"]["home_record"] in champ and r["title_game"]["away_record"] in champ, champ
    rounds = page.eval_on_selector_all("#tab-summary .rcp-round", "els => els.map(e => [e.querySelector('.go-kicker').textContent.trim(), e.querySelectorAll('.rcp-pair').length])")
    assert [x[0] for x in rounds] == ["First Round", "Quarterfinals", "Semifinals", "National Championship"] and [x[1] for x in rounds] == [4, 4, 2, 1], rounds
    assert page.eval_on_selector_all("#tab-summary .rcp-round .rcp-gm.won", "els => els.length") == 11, "a winner in bold in every played game"
    assert "BOWL" in page.inner_text("#tab-summary .rcp-round >> nth=2").upper(), "the bowl name under a semifinal"
    # the Heisman
    h = s["heisman"]
    heis = page.inner_text("#tab-summary .rcp-heis")
    assert h["winner"]["name"] in heis and f"{h['share']}%" in heis and f"{h['winner']['points']:,}" in heis, heis
    # your season: three numbers, four facts, three tiles with ranks
    snap = page.eval_on_selector_all("#tab-summary .rcp-snap b", "els => els.map(e => e.textContent)")
    assert snap == [f"{m['points_per_game']:.1f}", f"{m['allowed_per_game']:.1f}", str(m["longest_streak"])], snap
    kv = page.inner_text("#tab-summary .rcp-kv")
    assert f"{m['conf_wins']}-{m['conf_losses']}" in kv and f"{m['non_conf_wins']}-{m['non_conf_losses']}" in kv, kv
    tiles = page.eval_on_selector_all("#tab-summary .rcp-tile", "els => els.map(e => [e.querySelector('b').textContent, e.querySelector('span').textContent, e.querySelector('small').textContent])")
    assert [t[1] for t in tiles] == ["Total Offense", "Total Defense", "Turnover Margin"], tiles
    ts = m["team_stats"]
    assert ts and tiles[0][0] == f"{ts['total_offense']['value']:.1f}" and tiles[1][2].endswith(f"of {ts['total_defense']['of']}"), tiles
    assert re.match(r"^[+-]?\d+$", tiles[2][0]) and re.match(r"^\d+(st|nd|rd|th) of \d+$", tiles[2][2]), tiles
    # highlights, the stories, the leaders
    hl = page.eval_on_selector_all("#tab-summary .rcp-hl-row .rcp-hl-k", "els => els.map(e => e.textContent)")
    assert "Best Win" in hl and ("Worst Loss" in hl or "Closest Loss" in hl), hl
    assert m["best_win"]["opponent_name"] in page.inner_text("#tab-summary .rcp-hl"), m["best_win"]
    stories = page.eval_on_selector_all("#tab-summary .rcp-story", "els => els.map(e => [e.querySelector('.go-kicker').textContent, e.classList.contains('good'), e.classList.contains('bad'), e.querySelector('p').textContent])")
    assert [x[0] for x in stories] == ["Biggest Surprise", "Biggest Disappointment"] and stories[0][1] and stories[1][2], stories
    assert all(x[3].endswith(".") for x in stories), stories
    assert r["surprises"][0]["name"] in page.inner_text("#tab-summary .rcp-story.good") and r["disappointments"][0]["name"] in page.inner_text("#tab-summary .rcp-story.bad")
    nat = page.inner_text("#tab-summary .rcp-lead")
    assert r["national_leaders"]["passing"]["name"] in nat and r["national_leaders"]["sacks"]["name"] in nat, nat
    if r["mine"]["leaders"].get("passer"):
        assert r["mine"]["leaders"]["passer"]["name"] in page.inner_text("#tab-summary .rcp-row")
    # the bars: the champion card's bar in the champion's color, Your Season's in yours, both flush with the card's
    # top (no edge line, no wash), the title in the ink, square corners
    edge = page.evaluate("""() => {
      const bar = (sel) => { const c = document.querySelector(sel), b = c.querySelector(':scope > .card-bar'); const cs = getComputedStyle(b), cc = getComputedStyle(c);
        const r = b.getBoundingClientRect(), cr = c.getBoundingClientRect();
        return { bg: cs.backgroundColor, ink: cs.color, top: Math.round(r.top - cr.top), left: Math.round(r.left - cr.left), width: Math.round(cr.width - r.width),
                 edge: cc.borderTopWidth, wash: cc.backgroundImage, radius: cc.borderRadius, barRadius: cs.borderRadius, caps: cs.textTransform, size: cs.fontSize }; };
      return [bar('#tab-summary .rcp-champ'), bar('#tab-summary .rcp-mine')]; }""")
    for b in edge:
        assert b["edge"] == "1px" and b["wash"] == "none" and b["radius"] == "0px" and b["barRadius"] == "0px", b
        assert b["top"] == 1 and b["left"] == 1 and b["width"] == 2, b           # flush with the card's top and sides (inside its 1 px border)
        assert b["caps"] == "uppercase" and b["size"] == "12px", b
        assert b["bg"] not in ("rgba(0, 0, 0, 0)", "transparent") and b["ink"] != b["bg"], b
    mine_bar, champ_bar = edge[1]["bg"], edge[0]["bg"]
    assert mine_bar == page.evaluate("() => getComputedStyle(document.body).getPropertyValue('--go-primary').trim() && getComputedStyle(document.querySelector('#tab-summary .rcp-mine > .card-bar')).backgroundColor")
    clean(page, "#tab-summary", errors)
    def columns(width):
        n = page.evaluate("() => getComputedStyle(document.querySelector('#tab-summary .rcp-main')).gridTemplateColumns.split(' ').length")
        assert n == (2 if width > 999 else 1), (width, n)
    both_widths(page, "#tab-summary", "recap", columns)
    # the box-score links: the title game, a highlight
    page.click("#tab-summary .rcp-site .rcp-link")
    page.wait_for_selector(".modal:not([hidden]) #sbox-score-row", timeout=60_000)
    assert r["champion_name"].split()[0] in page.inner_text("#sbox-score-row")
    page.click("#modal-close")
    page.wait_for_selector("#modal", state="hidden", timeout=10_000)
    if page.query_selector("#tab-summary button.rcp-hl-row"):
        page.click("#tab-summary button.rcp-hl-row >> nth=0")
        page.wait_for_selector(".modal:not([hidden]) #sbox-score-row", timeout=60_000)
        assert s["team_name"] in page.inner_text("#sbox-score-row")
        page.click("#modal-close")
        page.wait_for_selector("#modal", state="hidden", timeout=10_000)
    # Back to the Office
    page.goto(f"{base}/index.html?id={sid}&tab=summary")
    page.wait_for_selector("#tab-summary .rcp-acts", timeout=120_000)
    page.click("#tab-summary .rcp-acts button:has-text('Back to the Office')")
    page.wait_for_selector("#tab-office:not([hidden]) .ofc-hero", timeout=60_000)
    assert "tab=office" in page.url
    # Awards from the recap
    page.go_back()
    page.wait_for_selector("#tab-summary:not([hidden]) .rcp-acts", timeout=60_000)
    page.click("#tab-summary .rcp-acts button:has-text('Awards')")
    page.wait_for_selector("#tab-awards:not([hidden]) .aw-main", timeout=60_000)
    clean(page, "#tab-awards", errors)


def check_awards(page, base, sid, errors) -> None:
    s = call(base, f"/api/season/{sid}")
    d = call(base, f"/api/season/{sid}/awards")
    open_awards(page, base, sid)
    assert "aview" not in page.url or "aview=overview" in page.url
    h = d["national"]["heisman"]
    hero = page.inner_text("#tab-awards .aw-heis")
    assert h["winner"]["name"] in hero and f"{h['share']}%" in hero, hero
    fin = page.eval_on_selector_all("#tab-awards .aw-fin > div", "els => els.map(e => e.querySelector('.aw-place').textContent)")
    assert fin == ["2nd", "3rd", "4th", "5th"], fin
    cards = page.eval_on_selector_all("#tab-awards .aw-cards[data-group=national] .aw-card", "els => els.map(e => e.querySelector('.go-kicker').textContent)")
    assert len(cards) == len(d["national"]["awards"]) + len([a for a in d["postseason"]["awards"] if a["kind"] != "coach"]), cards
    assert "Maxwell Award" in cards and "Doak Walker Award" in cards, cards
    # what an award is for waits behind the ⓘ beside its name, not on the card
    first = "#tab-awards .aw-cards[data-group=national] .aw-card >> nth=0"
    assert page.eval_on_selector(first, "c => !c.querySelector('.aw-card-head small')"), "the blurb is off the bar"
    assert page.eval_on_selector(first, "c => c.querySelector('.aw-card-head button.go-info') !== null"), "an ⓘ beside the name"
    page.hover(f"{first} >> .aw-card-head button.go-info")
    page.wait_for_selector(f"{first} >> .aw-card-head .go-info-box.show", timeout=5_000)
    blurb = page.inner_text(f"{first} >> .aw-card-head .go-info-box")
    assert blurb[0].isupper() and blurb.endswith("."), blurb
    tags = page.eval_on_selector_all("#tab-awards .aw-card .go-tag", "els => els.map(e => e.textContent.trim())")
    assert tags and all(t == "Winner" for t in tags), set(tags)
    w = d["national"]["awards"][0]["winner"]
    assert w["name"] in page.inner_text("#tab-awards .aw-cards[data-group=national] .aw-card >> nth=0")
    coach = page.eval_on_selector_all("#tab-awards .aw-cards[data-group=coach] .aw-card", "els => els.length")
    assert coach == len(d["national"]["coach_awards"]) + 1, coach
    # your team's podium and honors
    pod = page.eval_on_selector_all("#tab-awards .aw-mine .aw-pod b", "els => els.map(e => Number(e.textContent))")
    assert len(pod) == 3 and pod[0] == len(d["mine"]) and pod[1] == sum(1 for m in d["mine"] if m["place"] == "winner"), (pod, len(d["mine"]))
    assert pod[2] == len({m["who"] for m in d["mine"]}), pod
    assert s["team_name"] in page.inner_text("#tab-awards .aw-mine .go-kicker")
    res = page.eval_on_selector_all("#tab-awards .aw-mine .aw-res", "els => els.map(e => [e.textContent, e.classList.contains('w')])")
    assert all(t for t, _ in res) and all(gold == (t == "Winner") for t, gold in res), res
    assert page.query_selector("#tab-awards .aw-views .go-chip:has-text('My Team · " + str(len(d["mine"])) + "')")
    # the consensus All-America team by unit, in place
    aa = d["national"]["all_america"]
    rows = page.eval_on_selector_all("#tab-awards .aw-aa .aw-aa-row", "els => els.map(e => [e.querySelector('.aw-slot').textContent, e.querySelector('b').textContent, (e.querySelector('.aw-unan') || e.querySelector('.aw-res')).textContent])")
    assert rows and all(slot in ("QB", "RB", "WR", "TE", "C", "OL") for slot, _, _ in rows), rows
    assert all(x == "Unanimous" or re.match(r"^[345] of 5$", x) for _, _, x in rows), rows
    assert f"{len(aa['consensus'])} consensus All-Americans, {len(aa['unanimous'])} unanimous." in page.inner_text("#tab-awards .aw-aa-card")
    page.evaluate("() => { document.querySelector('#tab-awards .aw-aa').dataset.probe = '1'; }")
    page.click("#tab-awards .aw-seg .go-seg-btn:has-text('Defense')")
    page.wait_for_function("() => [...document.querySelectorAll('#tab-awards .aw-aa .aw-aa-row')].every(e => !/^(QB|RB|WR|TE|C|OL)$/.test(e.querySelector('.aw-slot').textContent))", timeout=10_000)
    assert page.evaluate("() => document.querySelector('#tab-awards .aw-aa').dataset.probe") == "1", "the list is patched, not rebuilt"
    # the conference card names your conference
    assert d["my_conference"].split()[0] in page.inner_text("#tab-awards .aw-conf .go-kicker")
    # the filter chips patch the grid in place
    page.evaluate("() => { document.querySelector('#tab-awards .aw-cards[data-group=national]').dataset.probe = '1'; window.scrollTo(0, 300); }")
    y = page.evaluate("() => window.scrollY")
    page.click("#tab-awards .aw-filters .go-chip:has-text('Defense')")
    page.wait_for_function("() => document.querySelector('#tab-awards .aw-cards[data-group=national]').dataset.filter === 'defense'", timeout=10_000)
    time.sleep(0.4)
    after = page.eval_on_selector_all("#tab-awards .aw-cards[data-group=national] .aw-card:not(.go-leaving)", "els => els.map(e => e.querySelector('.go-kicker').textContent)")
    assert 0 < len(after) < len(cards) and "Chuck Bednarik Award" in after and "Maxwell Award" not in after, after
    assert page.evaluate("() => document.querySelector('#tab-awards .aw-cards[data-group=national]').dataset.probe") == "1", "the grid is patched, not rebuilt"
    assert abs(page.evaluate("() => window.scrollY") - y) <= 2, "the scroll stays"
    assert page.evaluate("() => document.querySelector('#tab-awards .aw-filters .go-chip.on').textContent.trim()") == "Defense"
    page.click("#tab-awards .aw-filters .go-chip:has-text('All')")
    page.wait_for_function("(n) => document.querySelectorAll('#tab-awards .aw-cards[data-group=national] .aw-card').length === n", arg=len(cards), timeout=10_000)
    clean(page, "#tab-awards", errors)
    both_widths(page, "#tab-awards", "awards")
    # the other views stay, as chips, and keep the address
    for view, wait in (("heisman", "#tab-awards table.stats"), ("national", "#tab-awards .aw-cards"), ("allamerica", "#tab-awards table.stats"), ("conference", "#tab-awards .aw-cards, #tab-awards table.stats"), ("mine", "#tab-awards table.stats")):
        page.click(f"#tab-awards .aw-views .go-chip[data-v={view}]")
        page.wait_for_selector(wait, timeout=30_000)
        page.wait_for_function(f"() => /aview={view}/.test(location.search)", timeout=10_000)
        clean(page, "#tab-awards", errors)
    page.reload()
    page.wait_for_selector("#tab-awards:not([hidden]) table.stats", timeout=120_000)
    assert page.evaluate("() => document.querySelector('#tab-awards .aw-views .go-chip.on').dataset.v") == "mine", "a deep link keeps its view"
    page.click("#tab-awards .aw-views .go-chip[data-v=overview]")
    page.wait_for_selector("#tab-awards .aw-main", timeout=30_000)


if __name__ == "__main__":
    check_grade()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("recap and awards test skipped: Playwright is not installed")
        raise SystemExit(0)
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    sid = None
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(base + "/api/teams", timeout=2)
                break
            except OSError:
                time.sleep(0.5)
        sid = call(base, "/api/season", {"team": "smu", "mode": "full", "career": True, "seed": 44})["id"]
        call(base, f"/api/season/{sid}/settings", {"auto_recruit": True})
        advance_to(base, sid, 5)
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"recap and awards test skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.dismiss())
            check_live(page, base, sid, errors)
            advance_to(base, sid, 19)
            check_landing(page, base, sid)
            check_recap(page, base, sid, errors)
            check_awards(page, base, sid, errors)
            browser.close()
        print("recap and awards ok: Season So Far, the landing, the champion, the bracket, the Heisman, the grade, the tiles, the box scores, the Office, the Awards overview, the filters in place")
    finally:
        server.terminate()
        if sid:
            try:
                subprocess.run([sys.executable, "-c", f"from sim import season; import shutil; from pathlib import Path; p = season.SEASONS_DIR / '{sid}.json'; p.unlink(missing_ok=True); shutil.rmtree(season.SEASONS_DIR / '{sid}', ignore_errors=True)"], cwd=ROOT, check=False)
            except Exception:  # noqa: BLE001
                pass
