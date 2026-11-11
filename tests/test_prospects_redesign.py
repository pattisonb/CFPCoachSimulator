"""The Prospects tab, rebuilt from the player's mockup (web/recruiting.js renderProspects, web/prospects.css), in a
browser at 1280 and 400 px in the light and the dark theme: the header (Prospects · Class of YYYY, a count line, the
class by star level, all read from the API's summary); Your Needs chips (the count still to fill, ✓ when covered; a
tap filters the list to the position); the filters still filter (stars, position, status, search, Recommended for You,
the sort) and live in the address, a refresh keeping them; the table's columns (Pos is the game's position, Potential
your staff's read or Not Read, with Scouted beside it, never the truth); + Board and a Send a Scout patch the row and the footprint's count in place (the table
is never redrawn) and ✓ On Board takes him off again; Your Footprint is the game's US map with the API's counts and
View Map opens the full map; Class Outlook is your commits of the spots and by star level as plain counts (no targets);
Top Uncommitted is the class's best three without a commitment, and View All lists the uncommitted; a row opens the
Prospect Profile. On every screen: no sideways scroll, flat backgrounds (no gradient), labels in Title Case, no FCS
stand-in's name, no null; at 400 px every control is 44 px tall and a row shows the name, the interest and the board
button; the cards line up (the list and the side column end on one line at 1280, the side cards two to a row with
equal heights and the lone third across the row at 900, one column at 400).
Set PROSPECTS_SHOTS=<folder> to save the four screenshots. Needs Playwright with a Chromium; skipped without one.
(Run as a file.)"""
import os
import random
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

from test_career_e2e import call, free_port, launch   # noqa: E402
from test_deep_links import params, reload, tab_on, wait_url   # noqa: E402
from test_ux_sweep import open_tab, toasted   # noqa: E402

SMALL = {"a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by"}
ROWS = "#tab-prospects .pr-table tbody tr.pr-row"


def title_case_bad(text: str) -> bool:
    words = re.findall(r"[A-Za-z][\w'’-]*", text)
    return any(w[0].islower() and not (w in SMALL and 0 < i < len(words) - 1) for i, w in enumerate(words))


def wait_rows(page, pred_js: str, arg=None) -> None:
    page.wait_for_function(f"(arg) => {{ const m = document.querySelector('#tab-prospects .pr-main'); if (!m || m.hasAttribute('aria-busy')) return false; "
                           f"const rows = [...document.querySelectorAll('{ROWS}')]; return ({pred_js}); }}", arg=arg, timeout=30_000)


def first_ids(page, n=5) -> list:
    return page.eval_on_selector_all(ROWS, f"els => els.slice(0, {n}).map(e => e.dataset.key)")


def api(base, sid, qs="") -> dict:
    return call(base, f"/api/season/{sid}/prospects?limit=50{('&' + qs) if qs else ''}")


def check_header(page, base, sid, year, errors) -> None:
    d = api(base, sid)
    sm = d["summary"]
    assert page.eval_on_selector("#tab-prospects .pr-title", "e => e.textContent") == f"Prospects · Class of {year}"
    assert page.inner_text("#tab-prospects .pr-count") == f"The national recruiting database: {sm['total']:,} prospects."
    meters = page.eval_on_selector_all("#tab-prospects .pr-meter", "els => els.map(e => [e.querySelector('b').textContent, e.querySelector('span').textContent])")
    want = [[f"{sm['total']:,}", "Total Prospects"]] + [[f"{sm['stars'][k]:,}", f"{k}-Star"] for k in ("5", "4", "3", "2")]
    assert meters == want, (meters, want)
    assert sum(sm["stars"].values()) == sm["total"], "every prospect in the class has a star level"
    assert not errors, errors


def check_needs(page, base, sid, errors) -> None:
    needs = api(base, sid)["needs"]
    chips = page.eval_on_selector_all("#tab-prospects .pr-needs .pr-need", "els => els.map(e => e.textContent)")
    order = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"]
    want = [f"{g} {needs[g]['need']}" if needs[g]["need"] > 0 else f"{g} ✓" for g in order if g in needs]
    assert chips == want, (chips, want)
    assert page.inner_text("#tab-prospects .pr-needs .pr-needs-label").strip().lower() == "your needs"
    g = next(g for g in order if g in needs and needs[g]["need"] > 0)
    tbody = page.query_selector("#tab-prospects .pr-table tbody")
    page.click(f"#tab-prospects .pr-need[data-key='{g}']")
    want_ids = [r["id"] for r in api(base, sid, f"group={g}")["rows"][:5]]
    wait_rows(page, "rows.length && rows[0].dataset.key === arg", want_ids[0])
    assert first_ids(page) == want_ids and page.get_attribute(f".pr-need[data-key='{g}']", "aria-pressed") == "true"
    wait_url(page, lambda p: p.get("pgroup") == g, f"pgroup={g}")
    page.click(f"#tab-prospects .pr-need[data-key='{g}']")
    want_ids = [r["id"] for r in api(base, sid)["rows"][:5]]
    wait_rows(page, "rows.length && rows[0].dataset.key === arg", want_ids[0])
    assert page.evaluate("(e) => e.isConnected", tbody), "a needs chip patches the list in place"
    assert not errors, errors


def check_filters(page, base, sid, errors) -> None:
    tbody = page.query_selector("#tab-prospects .pr-table tbody")
    # Stars: every row is a five-star, the address keeps it, a refresh too
    page.select_option("select[aria-label=Stars]", "5")
    want = [r["id"] for r in api(base, sid, "stars=5")["rows"]]
    wait_rows(page, "rows.length === arg.length && rows.every((r, i) => r.dataset.key === arg[i])", want)
    assert all(s == "5 stars" for s in page.eval_on_selector_all(f"{ROWS} .pr-c-stars .go-stars", "els => els.map(e => e.getAttribute('aria-label'))"))
    wait_url(page, lambda p: p.get("pstars") == "5", "pstars=5")
    reload(page, ROWS)
    wait_rows(page, "rows.length === arg.length && rows.every((r, i) => r.dataset.key === arg[i])", want)
    assert page.input_value("select[aria-label=Stars]") == "5", "a refresh keeps the filter"
    tbody = page.query_selector("#tab-prospects .pr-table tbody")
    # Position on top of it
    page.select_option("select[aria-label=Position]", "QB")
    want = [r["id"] for r in api(base, sid, "stars=5&position=QB")["rows"]]
    wait_rows(page, "rows.length === arg.length && rows.every((r, i) => r.dataset.key === arg[i])", want)
    assert all(p == "QB" for p in page.eval_on_selector_all(f"{ROWS} .pr-c-pos", "els => els.map(e => e.textContent)"))
    page.select_option("select[aria-label=Position]", "")
    page.select_option("select[aria-label=Stars]", "")
    # Status: Uncommitted hides the commits
    page.select_option("select[aria-label=Status]", "committed")
    want = [r["id"] for r in api(base, sid, "status=committed")["rows"]]
    wait_rows(page, "rows.length === arg.length && rows.every((r, i) => r.dataset.key === arg[i])", want)
    assert want, "the save has commitments"
    st = page.eval_on_selector_all(f"{ROWS} .pr-c-status .go-tag", "els => els.map(e => e.textContent)")
    assert all(re.fullmatch(r"(Verbal|Hard Commit): .+", t) for t in st), st
    page.select_option("select[aria-label=Status]", "open")
    want = [r["id"] for r in api(base, sid, "status=open")["rows"][:5]]
    wait_rows(page, "rows.length && rows.slice(0, 5).every((r, i) => r.dataset.key === arg[i])", want)
    assert set(page.eval_on_selector_all(f"{ROWS} .pr-c-status .go-tag", "els => els.map(e => e.textContent)")) <= {"Uncommitted", "Leaning FCS", "Quiet"}
    page.select_option("select[aria-label=Status]", "")
    # the sort: interest in you first
    page.select_option("select[aria-label=Sort]", "interest")
    want = [r["id"] for r in api(base, sid, "sort=interest")["rows"][:5]]
    wait_rows(page, "rows.length && rows.slice(0, 5).every((r, i) => r.dataset.key === arg[i])", want)
    wait_url(page, lambda p: p.get("psort") == "interest", "psort=interest")
    page.select_option("select[aria-label=Sort]", "rank")
    # the search
    name = api(base, sid)["rows"][7]["name"]
    page.fill("#tab-prospects input[aria-label='Search by name']", name)
    wait_rows(page, "rows.length >= 1 && rows.every(r => r.querySelector('.go-list-id b').textContent.toLowerCase().includes(arg))", name.lower())
    page.fill("#tab-prospects input[aria-label='Search by name']", "")
    # Recommended for You: on, the status select reads Any Status, the button says how many to add; off again
    page.click("#tab-prospects button.pr-rec")
    page.wait_for_selector("#tab-prospects button.go-btn:has-text('Add These')", timeout=60_000)
    assert page.get_attribute("#tab-prospects button.pr-rec", "aria-pressed") == "true" and page.input_value("select[aria-label=Status]") == ""
    wait_url(page, lambda p: p.get("pstatus") == "recommended", "pstatus=recommended")
    page.click("#tab-prospects button.pr-rec")
    want = [r["id"] for r in api(base, sid)["rows"][:5]]
    wait_rows(page, "rows.length && rows.slice(0, 5).every((r, i) => r.dataset.key === arg[i])", want)
    assert page.evaluate("(e) => e.isConnected", tbody), "the filters patch the table in place"
    assert tab_on(page, "prospects")
    assert not errors, errors


def check_table(page, base, sid, errors) -> None:
    heads = page.eval_on_selector_all("#tab-prospects .pr-table thead th", "els => els.map(e => e.textContent.replace(/[▲▼]/g, ''))")   # the sort mark aside
    assert heads == ["#", "Prospect", "Pos", "Ht", "Wt", "Stars", "Status", "Interest in You", "Scouted", "Potential", "Board"], heads
    rows = api(base, sid)["rows"]
    cells = page.eval_on_selector_all(ROWS, """els => els.map(e => ({id: e.dataset.key, rank: e.querySelector('.pr-c-rank').textContent,
      name: e.querySelector('.go-list-id b').textContent, pos: e.querySelector('.pr-c-pos').textContent, status: e.querySelector('.pr-c-status').textContent,
      int: e.querySelector('.pr-c-int').textContent, sc: e.querySelector('.pr-c-sc').textContent, pot: e.querySelector('.pr-c-pot').textContent, act: e.querySelector('.pr-c-act').textContent}))""")
    assert [c["id"] for c in cells] == [r["id"] for r in rows]
    for c, r in zip(cells, rows):
        assert c["rank"] == f"#{r['national_rank']}" and c["name"] == r["name"]
        assert c["pos"] == r["display_pos"], (c["pos"], r["display_pos"], r["ea_position"])
        assert c["int"] == r["interest_level"] and c["int"] in ("High", "Medium", "Low")
        p, looks = r["our_potential"], r["looks"]
        assert c["pot"] == ("Not Read" if not p else p[0] if p[0] == p[1] else f"{p[0]} – {p[1]}"), (c["pot"], p)
        assert c["sc"] == ("Fully Scouted" if looks >= 3 else f"{looks} of 3 Looks" if looks else "Not Yet"), (c["sc"], looks)
        assert c["act"] == ("✓ On Board" if r["on_board"] else "+ Board")
    assert any(c["pot"] == "Not Read" and c["sc"] == "Not Yet" for c in cells) and any(c["sc"] == "Fully Scouted" and c["pot"] != "Not Read" for c in cells), "scouted and unscouted rows both show"
    st = {c["status"] for c in cells}
    assert "Uncommitted" in st and any(s.startswith("Verbal: ") for s in st), st
    # a row opens his Prospect Profile over the tab
    page.click(f"{ROWS} >> nth=1 >> .pr-c-int")
    page.wait_for_selector(".modal:not([hidden]) .rc-profile-name", timeout=60_000)
    assert page.inner_text(".modal:not([hidden]) .rc-profile-name") == cells[1]["name"]
    wait_url(page, lambda p: p["modal"] == [f"profile:{cells[1]['id']}"], "modal=profile:…")
    page.click(".modal:not([hidden]) .modal-close")
    wait_url(page, lambda p: not p["modal"], "no modal")
    assert tab_on(page, "prospects")
    assert not errors, errors


def check_board_toggle(page, base, sid, errors) -> None:
    rows = api(base, sid)["rows"]
    r = next(x for x in rows if not x["on_board"] and not x["offered"])
    tbody = page.query_selector("#tab-prospects .pr-table tbody")
    tr = page.query_selector(f"{ROWS}[data-key='{r['id']}']")
    count = lambda: int(page.inner_text("#tab-prospects .pr-fp-stat[data-key=board] b").replace(",", ""))
    before = count()
    assert before == api(base, sid)["summary"]["footprint"]["board"]
    page.click(f"{ROWS}[data-key='{r['id']}'] .pr-board")
    toasted(page, f"{r['name']} is on your board.")
    page.wait_for_function("(id) => document.querySelector(`tr.pr-row[data-key='${id}'] .pr-board`).textContent === '✓ On Board'", arg=r["id"], timeout=10_000)
    assert count() == before + 1 and r["id"] in {b["id"] for b in call(base, f"/api/season/{sid}/recruiting")["board"]}
    assert page.evaluate("([a, b]) => a.isConnected && b.isConnected", [tbody, tr]), "+ Board patches the row in place"
    assert page.get_attribute(f"{ROWS}[data-key='{r['id']}'] .pr-board", "aria-pressed") == "true", page.eval_on_selector(f"{ROWS}[data-key='{r['id']}'] .pr-board", "e => e.outerHTML")
    page.wait_for_function("(id) => !!document.querySelector(`.pr-map circle.us-dot[data-id='${id}']`)", arg=r["id"], timeout=15_000)
    page.click(f"{ROWS}[data-key='{r['id']}'] .pr-board")
    toasted(page, f"{r['name']} is off your board.")
    page.wait_for_function("(id) => document.querySelector(`tr.pr-row[data-key='${id}'] .pr-board`).textContent === '+ Board'", arg=r["id"], timeout=10_000)
    assert count() == before and page.evaluate("([a, b]) => a.isConnected && b.isConnected", [tbody, tr])
    assert not modals_open(page), "the board button never opens his profile"
    assert not errors, errors


def check_scout_in_place(page, base, sid, errors) -> None:
    """Send a Scout from the Prospect Profile opened off a row: the row's Scouted and Potential cells follow in place
    (1 of 3 Looks and the read's range), with no redraw of the table and no reload of the list."""
    rows = api(base, sid)["rows"]
    r = next(x for x in rows if not x["looks"] and x["can_scout"] and not x["committed"] and not x["signed"])
    tbody = page.query_selector("#tab-prospects .pr-table tbody")
    tr = page.query_selector(f"{ROWS}[data-key='{r['id']}']")
    assert page.inner_text(f"{ROWS}[data-key='{r['id']}'] .pr-c-sc") == "Not Yet" and page.inner_text(f"{ROWS}[data-key='{r['id']}'] .pr-c-pot") == "Not Read"
    page.click(f"{ROWS}[data-key='{r['id']}'] .pr-c-int")
    page.wait_for_selector(".modal:not([hidden]) .rc-profile-name", timeout=60_000)
    page.click(".modal:not([hidden]) .go-subtabs button[data-sub=scouting]")
    page.wait_for_selector(".modal:not([hidden]) [data-key=report] .go-btn:has-text('Send a Scout')", timeout=30_000)
    page.click(".modal:not([hidden]) [data-key=report] .go-btn:has-text('Send a Scout')")
    page.wait_for_function("(id) => document.querySelector(`tr.pr-row[data-key='${id}'] .pr-c-sc`).textContent === '1 of 3 Looks'", arg=r["id"], timeout=30_000)
    after = next(x for x in api(base, sid)["rows"] if x["id"] == r["id"])
    p = after["our_potential"]
    assert after["looks"] == 1 and p, after
    assert page.inner_text(f"{ROWS}[data-key='{r['id']}'] .pr-c-pot") == (p[0] if p[0] == p[1] else f"{p[0]} – {p[1]}"), "the row's Potential is the read's range"
    assert page.evaluate("([a, b]) => a.isConnected && b.isConnected", [tbody, tr]), "a Send patches the row in place"
    page.click(".modal:not([hidden]) .modal-close")
    wait_url(page, lambda q: not q["modal"], "no modal")
    assert page.inner_text(f"{ROWS}[data-key='{r['id']}'] .pr-c-sc") == "1 of 3 Looks", "the patched row stands once the profile closes"
    assert not errors, errors


def modals_open(page) -> int:
    return page.evaluate("() => [...document.querySelectorAll('.modal')].filter(m => !m.hidden).length")


def check_side(page, base, sid, errors) -> None:
    sm = api(base, sid)["summary"]
    # Your Footprint: the game's map (every state), the counts
    assert page.evaluate("() => document.querySelectorAll('.pr-map svg.us-map .us-state').length") == 51
    stats = page.eval_on_selector_all(".pr-fp-stat", "els => els.map(e => [e.dataset.key, e.querySelector('b').textContent, e.querySelector('span').textContent])")
    fp = sm["footprint"]
    assert stats == [["board", f"{fp['board']:,}", "On Board"], ["contact", f"{fp['contact']:,}", "In Contact"], ["evaluated", f"{fp['evaluated']:,}", "Evaluated"]], stats
    assert fp["board"] > 0 and fp["evaluated"] > 0 and fp["contact"] > 0
    assert page.evaluate("() => document.querySelectorAll('.pr-map .us-dot').length") > 0, "the board as dots"
    page.click(".pr-card[data-key=footprint] .pr-more")
    page.wait_for_selector(".modal:not([hidden]) .go-map .go-map-body:not([hidden]) svg.us-map", timeout=15_000)
    page.click(".modal:not([hidden]) .modal-close")
    page.wait_for_function("() => ![...document.querySelectorAll('.modal')].some(m => !m.hidden)", timeout=10_000)
    # Class Outlook: commits of spots, then plain counts by star level, never a target
    o = sm["outlook"]
    assert o["commits"] > 0, "the save has a commit to you"
    assert page.inner_text(".pr-card[data-key=outlook] .pr-co-total").strip() == f"{o['commits']} / {o['spots']} Commits"
    rows = page.eval_on_selector_all(".pr-co-row", "els => els.map(e => [e.querySelector('.pr-co-label').textContent, e.querySelector('.pr-co-n').textContent])")
    assert rows == [[f"{k}-Star", str(o["by_stars"][k])] for k in ("5", "4", "3", "2")], rows
    assert sum(o["by_stars"].values()) == o["commits"]
    text = page.inner_text(".pr-card[data-key=outlook]")
    assert not re.search(r"target|goal", text, re.I), f"no targets or goals: {text!r}"
    assert len(re.findall(r"\d+\s*/\s*\d+", text)) == 1, f"only the commits of the spots is a fraction: {text!r}"
    # Top Uncommitted: the class's best three without a commitment
    top = page.eval_on_selector_all(".pr-top li", "els => els.map(e => e.dataset.key)")
    assert top == [t["id"] for t in sm["top"]] and len(top) == 3
    ranked = [r for r in api(base, sid, "status=open")["rows"] if not r["committed"] and not r["signed"]][:3]
    assert top == [r["id"] for r in ranked], (top, [r["id"] for r in ranked])
    page.click(".pr-card[data-key=top] .pr-more")
    wait_url(page, lambda p: p.get("pstatus") == "open", "View All lists the uncommitted")
    wait_rows(page, "rows.length && rows[0].dataset.key === arg", top[0])
    page.select_option("select[aria-label=Status]", "")
    wait_url(page, lambda p: not p.get("pstatus"), "the status cleared")
    page.click(f".pr-top li[data-key='{top[1]}'] button")
    page.wait_for_selector(".modal:not([hidden]) .rc-profile-name", timeout=60_000)
    page.click(".modal:not([hidden]) .modal-close")
    page.wait_for_function("() => ![...document.querySelectorAll('.modal')].some(m => !m.hidden)", timeout=10_000)
    assert not errors, errors


def boxes(page, sel) -> list:
    return page.eval_on_selector_all(sel, "els => els.filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })")


def table_fits(page) -> bool:
    """The table never runs past its card, and never scrolls sideways inside it."""
    return page.evaluate("""() => { const w = document.querySelector('#tab-prospects .pr-table-wrap'), t = w.querySelector('table'), m = document.querySelector('#tab-prospects .pr-main');
      return w.scrollWidth <= w.clientWidth + 1 && t.getBoundingClientRect().right <= m.getBoundingClientRect().right + 0.5; }""")


def check_fit(page, base, sid, widths) -> None:
    """Between the screens: at every width the table fits its card (columns give way as the card narrows)."""
    for w in widths:
        page.set_viewport_size({"width": w, "height": 900})
        time.sleep(0.5)
        assert table_fits(page), f"the table runs past its card at {w}: " + str(page.evaluate("() => { const w = document.querySelector('#tab-prospects .pr-table-wrap'); return [w.scrollWidth, w.clientWidth, [...w.querySelectorAll('thead th')].map(e => e.className + ':' + Math.round(e.getBoundingClientRect().width))]; }"))
        assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), f"no sideways scroll at {w}"


def check_screen(page, width, theme, fcs_names, shots, errors) -> None:
    """One screen: the layout rules at this width in this theme."""
    page.evaluate("(t) => { document.documentElement.dataset.theme = t; }", theme)
    page.evaluate("() => window.scrollTo(0, 0)")
    time.sleep(0.4)
    if shots:
        Path(shots).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(Path(shots) / f"prospects-{width}-{theme}.png"), full_page=True)
    where = f"{width} {theme}"
    assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), f"no sideways scroll at {where}"
    assert table_fits(page), f"the table fits its card at {where}"
    if width >= 1280:
        assert page.evaluate("() => getComputedStyle(document.querySelector('#tab-prospects th.pr-c-ht')).display !== 'none'"), "Ht and Wt show at 1280: " + str(page.evaluate("() => { const t = document.querySelector('#tab-prospects .pr-table'); t.classList.remove('pr-fit-1', 'pr-fit-2', 'pr-fit-3'); const w = t.parentElement; return [w.scrollWidth, w.clientWidth, [...t.querySelectorAll('thead th')].map(e => e.className + ':' + Math.round(e.getBoundingClientRect().width))]; }"))
    wide = page.evaluate("() => [...document.querySelectorAll('#tab-prospects *')].filter(e => e.offsetParent && e.getBoundingClientRect().right > window.innerWidth + 1).map(e => e.className)")
    assert not wide, f"past the screen at {where}: {wide[:4]}"
    grads = page.evaluate("() => [...document.querySelectorAll('#tab-prospects, #tab-prospects *')].filter(e => /gradient/.test(getComputedStyle(e).backgroundImage)).map(e => e.className)")
    assert not grads, f"flat backgrounds, no gradients: {grads[:4]}"
    text = page.inner_text("#tab-prospects")
    assert not re.search(r"\b(null|undefined|NaN)\b", text), f"a null reached the page at {where}"
    for n in fcs_names:
        assert n not in text, f"an FCS stand-in's name on the page: {n}"
    labels = page.evaluate("""() => [...document.querySelectorAll('#tab-prospects th, #tab-prospects .pv-kick, #tab-prospects button, #tab-prospects .go-tag, #tab-prospects option, #tab-prospects .pr-meter span, #tab-prospects .pr-fp-stat span, #tab-prospects .pr-co-label, #tab-prospects .pr-co-total')]
      .filter(e => e.offsetParent || e.tagName === 'OPTION').map(e => (e.getAttribute('aria-label') && e.tagName === 'TH' && !e.textContent.trim() ? '' : e.textContent).trim()).filter(Boolean)""")
    bad = [t for t in labels if title_case_bad(t.split(":")[0]) or (":" in t and title_case_bad(t))]
    assert not bad, f"labels in Title Case at {where}: {bad[:6]}"
    lay = boxes(page, "#tab-prospects .pr-main") + boxes(page, "#tab-prospects .pr-side")
    cards = boxes(page, "#tab-prospects .pr-side > .pr-card")
    assert len(cards) == 3
    if width >= 1100:
        main, side = lay
        assert abs(main[1] - side[1]) <= 1 and abs(main[3] - side[3]) <= 1, f"the list and the side column start and end together: {lay}"
        assert abs(cards[-1][3] - main[3]) <= 1, "the last side card reaches the list's bottom: no empty gap"
        assert all(abs(c[0] - cards[0][0]) <= 1 and abs(c[2] - cards[0][2]) <= 1 for c in cards), "the side cards share one width"
        assert all(abs(cards[i + 1][1] - cards[i][3] - 16) <= 1 for i in range(2)), "the side cards stack with one gap"
    elif width >= 760:
        a, b, c = cards
        assert abs(a[1] - b[1]) <= 1 and abs(a[3] - b[3]) <= 1, f"two side cards to a row, equal heights: {cards}"
        assert abs(c[0] - a[0]) <= 1 and abs(c[2] - b[2]) <= 1, "the lone third card spans its row"
    else:
        main = lay[0]
        assert all(abs(c[0] - main[0]) <= 1 and abs(c[2] - main[2]) <= 1 for c in cards), f"one column on a phone: {cards} {main}"
        assert all(abs(cards[i + 1][1] - cards[i][3] - 16) <= 1 for i in range(2)), "the cards stack with one gap"
        short = page.evaluate("""() => [...document.querySelectorAll('#tab-prospects button, #tab-prospects select, #tab-prospects input')]
          .filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => (e.className || e.tagName) + ' ' + e.textContent.trim().slice(0, 20))""")
        assert not short, f"44 px controls on a phone: {short[:5]}"
        shown = page.eval_on_selector_all("#tab-prospects .pr-table thead th", "els => els.filter(e => e.offsetParent && getComputedStyle(e).display !== 'none').map(e => e.className)")
        assert shown == ["pr-c-who", "pr-c-int", "pr-c-act"], f"a phone row shows the name, the interest and the board button: {shown}"
        row = page.query_selector(ROWS)
        rb = row.bounding_box()
        for sel in (".go-list-id b", ".pr-c-int .go-tag", ".pr-board"):
            b = row.query_selector(sel).bounding_box()
            assert b["x"] >= rb["x"] - 0.5 and b["x"] + b["width"] <= rb["x"] + rb["width"] + 0.5, f"{sel} inside its row"
        tags = page.eval_on_selector_all(f"{ROWS} .pr-c-int .go-tag", "els => els.filter(e => e.scrollWidth > e.clientWidth + 1).length")
        assert tags == 0, "the interest word is never clipped"
        assert page.evaluate("() => { const m = document.querySelector('.pr-meters').getBoundingClientRect(); return [...document.querySelectorAll('.pr-meter')].every(e => e.getBoundingClientRect().right <= m.right + 1); }")
    assert not errors, errors


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("prospects redesign skipped: Playwright is not installed")
        raise SystemExit(0)
    from coach_career import recruiting
    from sim import season
    st = season.new_season("smu", "full", seed=71, career=True)
    rc = st["recruiting"]
    ranked = sorted(recruiting.visible(st), key=lambda pid: rc["prospects"][pid]["rank"])
    for i, pid in enumerate(ranked[2:40:3]):          # reads on some of the top of the class: Potential words and Not Read side by side
        recruiting.look(st, pid, 90, random.Random(f"prospects-{i}"), by="trip", weight=recruiting.REPORT_LOOKS)
    # commitments: two of the top ten elsewhere (Verbal: School), two to you (the Class Outlook counts)
    fbs = [t for t in recruiting.fbs_schools(st) if t != "smu"]
    for pid, school in ((ranked[3], fbs[0]), (ranked[6], fbs[1]), (ranked[60], "smu"), (ranked[200], "smu")):
        rc["status"][pid]["committed"] = school
    season.save_season(st)
    A = st["id"]
    year = rc.get("year") or (st.get("year", 2026) + 1)
    teams = season.load_teams()
    fcs_names = [t["name"] for t in teams.values() if t.get("fictional")]
    shots = os.environ.get("PROSPECTS_SHOTS")
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
        for pid in ranked[:2] + ranked[8:10]:
            call(base, f"/api/season/{A}/board", {"pid": pid, "on": True})
        call(base, f"/api/season/{A}/recruit", {"pid": ranked[8], "action": "message"})
        year = int(call(base, f"/api/season/{A}")["year"]) + 1
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"prospects redesign skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: d.accept())
            open_tab(page, base, A, "prospects", ROWS)
            page.wait_for_selector(".pr-map svg.us-map", timeout=30_000)
            check_header(page, base, A, year, errors)
            check_table(page, base, A, errors)
            check_needs(page, base, A, errors)
            check_filters(page, base, A, errors)
            check_board_toggle(page, base, A, errors)
            check_scout_in_place(page, base, A, errors)
            check_side(page, base, A, errors)
            page.select_option("select[aria-label=Status]", "committed")      # long status words: Verbal: School, Hard Commit: School
            wait_rows(page, "rows.length > 0")
            check_fit(page, base, A, (1440, 1280, 1180, 1100, 1000, 900, 800, 760, 700, 600, 500, 400, 360))
            page.set_viewport_size({"width": 1280, "height": 1000})
            page.select_option("select[aria-label=Status]", "")
            wait_rows(page, "rows.length === 50")
            check_fit(page, base, A, (1440, 1280, 1180, 1100, 1000, 900, 800, 760, 700, 600, 500, 400, 360))
            for width, height in ((1280, 1000), (900, 1000), (400, 860)):
                page.set_viewport_size({"width": width, "height": height})
                open_tab(page, base, A, "prospects", ROWS)
                page.wait_for_selector(".pr-map svg.us-map", timeout=30_000)
                for theme in ("dark", "light"):
                    check_screen(page, width, theme, fcs_names, shots if width != 900 else None, errors)
            # a phone: the board toggle still patches in place
            check_board_toggle(page, base, A, errors)
            browser.close()
        print("prospects redesign ok: the header, Your Needs, every filter (and the address), the table's columns, + Board and a Send a Scout in place, "
              "Your Footprint's map and counts, Class Outlook without targets, Top Uncommitted, the profile from a row; at 1280, 900 and 400 "
              "in both themes: no sideways scroll, flat, Title Case, no FCS stand-in, 44 px on a phone, the cards aligned")
    finally:
        try:
            call(base, f"/api/season/{A}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
