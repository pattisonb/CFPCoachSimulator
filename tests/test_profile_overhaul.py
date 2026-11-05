"""The recruit profile overhaul (web/profileview.js, web/profile.css, web/recruiting.js, web/scouting.js), in a browser at
1280 and 400 px, light and dark. One view of a recruit in three places: the board's pane, the Prospect Profile popup and
the Scouting Center. Checks:
- The board's header: five budget meters (Scouting Points among them) and Auto-Recruit; the list card and the pane line up.
- The pane's hero: name, stars, Pos | Height | Weight, Hometown · #rank; Nat. Rank, Pos. Rank (with the position), Class;
  Your Chance; Recruit ▾ and the watch star on the tab row. Tabs Overview · Scouting · Profile · History.
- The position is the game's display everywhere (a recruit listed EDGE who plays DT reads DT in the hero, the verdict
  and the comp).
- Overview: Recruiting Battle and Recruit Snapshot side by side, the Scout's Summary across; Scouting: the report and
  Attributes side by side, Looks & Uncertainty across; Attributes are five bars with their words; a grade's tooltip.
- An unscouted recruit: "Send a scout to read him." and empty bars reading "Not Scouted"; a partly scouted one: "Comp after
  his third look." and no comp; a complete report: the comp, once, in view without scrolling the pane at 1280x800.
- Profile: the traits rows (Who Decides, Cares About, Personality, His Story), a trait not known yet with its hint.
- History: the timeline, the notes and the interest changes.
- Alignment, by bounding boxes, at 1280 and with the pane narrowed: cards sharing a row have the same top and bottom
  (1 px), a full-width card spans the row's outer edges (1 px), and every gap between neighbors, across and down, is the
  same. The same on the Scouting Center and in the popup.
- The popup draws the same hero and tabs, without the Recruit menu. The Scouting Center's tabs Report · Looks · Profile.
- No sideways scroll; Title Case on every kicker, tab, stat label and button; no null/undefined/NaN; at 400 px every
  control in the pane stands 44 px tall.
Needs Playwright with a Chromium; skipped without one. OVERHAUL_SHOTS=<folder> saves screenshots."""
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch   # noqa: E402
from test_scene_window import wait_server   # noqa: E402

SHOTS = os.environ.get("OVERHAUL_SHOTS")
SMALL = {"a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by", "vs"}


def make_career():
    """A career whose board holds: a recruit listed EDGE who plays DT with a complete report (the comp), one with a
    partly scouted report, one never scouted, and the QB a coordinator likes (complete report)."""
    from coach_career import offseason, prospects, recruiting
    from sim import season
    me = "ohio-state"
    st = season.new_season(me, "full", seed=13, career=True)
    rc = st["recruiting"]
    order = [q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]) if not rc["prospects"][q].get("hidden")
             and not rc["status"][q]["signed"] and not rc["status"][q]["committed"]]
    read = lambda p, looks: {"looks": float(looks), "area": 0.0, "by": {"95": float(looks)},
                             "g": {g: [p["truth"][g], 1000.0 if looks >= 3 else 0.004] for g in recruiting.GROUPS}}
    odd = next((q for q in order if rc["prospects"][q]["position"] != prospects.display_pos(rc["prospects"][q]["ea_position"])
                and prospects.comp(prospects.ceiling(st, rc["prospects"][q]), rc["prospects"][q]["ea_position"], prospects.starter_pool())), None)
    assert odd, "a recruit whose listed position is not his game position, with a comp"
    part = next(q for q in order if q != odd)
    cold = next(q for q in order if q not in (odd, part) and q not in rc["reads"])
    rc["reads"][odd] = read(rc["prospects"][odd], 3)
    rc["reads"][part] = read(rc["prospects"][part], 1.5)
    rc["reads"].pop(cold, None)
    rc["board"] = [odd, part, cold]
    season.save_season(st)
    return st["id"], {"odd": odd, "part": part, "cold": cold}


def shot(page, name: str) -> None:
    if SHOTS:
        Path(SHOTS).mkdir(parents=True, exist_ok=True)
        page.mouse.move(2, 2)
        time.sleep(0.3)
        page.screenshot(path=str(Path(SHOTS) / f"overhaul-{name}.png"), full_page=False)


# ----- layout by bounding boxes ----------------------------------------------------------------------------------------
LAYOUT_JS = """(root) => {
  const out = [];
  for (const g of document.querySelectorAll(root + ' .pv-grid')) {
    if (!g.getClientRects().length) continue;
    const gr = g.getBoundingClientRect();
    const cards = [...g.children].filter((c) => c.getClientRects().length).map((c) => { const r = c.getBoundingClientRect();
      return { key: c.dataset.key, wide: c.classList.contains('pv-wide'), l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    out.push({ l: gr.left, r: gr.right, gap: parseFloat(getComputedStyle(g).columnGap), rowGap: parseFloat(getComputedStyle(g).rowGap), cards });
  }
  return out;
}"""


def check_layout(page, root: str, where: str, want_rows=None) -> list:
    """Cards in a row: same top and bottom; the row spans the grid; every gap the same (the gap token), across and down.
    Returns each grid's rows as lists of card keys."""
    grids = page.evaluate(LAYOUT_JS, root)
    assert grids, f"no card grid under {root} {where}"
    shapes = []
    for g in grids:
        rows = []
        for c in sorted(g["cards"], key=lambda c: (round(c["t"]), c["l"])):
            if rows and abs(rows[-1][0]["t"] - c["t"]) <= 1:
                rows[-1].append(c)
            else:
                rows.append([c])
        gap = g["gap"]
        assert abs(gap - g["rowGap"]) < 0.5, f"one gap token across and down {where}: {gap} vs {g['rowGap']}"
        for row in rows:
            row.sort(key=lambda c: c["l"])
            for c in row:
                assert abs(c["t"] - row[0]["t"]) <= 1 and abs(c["b"] - row[0]["b"]) <= 1, f"cards in a row line up top and bottom {where}: {[(x['key'], x['t'], x['b']) for x in row]}"
            assert abs(row[0]["l"] - g["l"]) <= 1 and abs(row[-1]["r"] - g["r"]) <= 1, f"a row spans the grid {where}: {[(x['key'], x['l'], x['r']) for x in row]} in {g['l']}..{g['r']}"
            for a, b in zip(row, row[1:]):
                assert abs((b["l"] - a["r"]) - gap) <= 1, f"the gap across is the token {where}: {a['key']}|{b['key']} {b['l'] - a['r']} vs {gap}"
            for c in row:
                if c["wide"]:
                    assert len(row) == 1 and abs(c["l"] - g["l"]) <= 1 and abs(c["r"] - g["r"]) <= 1, f"a full-width card spans the row {where}: {c}"
        for up, down in zip(rows, rows[1:]):
            assert abs((down[0]["t"] - max(c["b"] for c in up)) - gap) <= 1, f"the gap down is the token {where}: {down[0]['t'] - max(c['b'] for c in up)} vs {gap}"
        shape = [[c["key"] for c in row] for row in rows]
        shapes.append(shape)
    if want_rows is not None:
        assert shapes[0] == want_rows, f"the cards' rows {where}: {shapes[0]} (want {want_rows})"
    return shapes


def no_sideways(page, where: str, box: str = None) -> None:
    over = page.evaluate("""(box) => { const d = document.documentElement.scrollWidth - innerWidth;
      const b = box ? document.querySelector(box) : null; return { page: d, box: b ? b.scrollWidth - b.clientWidth : 0 }; }""", box)
    assert over["page"] <= 0 and over["box"] <= 0, f"no sideways scroll {where}: {over}"


def no_bad_text(page, sel: str, where: str) -> None:
    text = page.inner_text(sel)
    for bad in ("null", "undefined", "NaN", "[object"):
        assert not re.search(rf"\b{re.escape(bad)}", text), f"'{bad}' on the page {where}"


def title_case(page, sel: str, where: str) -> None:
    labels = page.eval_on_selector_all(sel, "els => els.filter(e => e.getClientRects().length).map(e => e.textContent.trim()).filter(Boolean)")
    assert labels, f"labels under {sel} {where}"
    for lab in labels:
        words = [w for w in re.split(r"[\s/·|()–\-]+", lab.replace("▾", "").replace("→", "")) if w and re.match(r"[A-Za-z]", w)]
        for i, w in enumerate(words):
            if i and w.lower() in SMALL:
                continue
            assert w[0].isupper() or w[0].isdigit(), f"Title Case: '{lab}' {where}"


def wait_cards(page, root: str, n: int = 2) -> None:
    page.wait_for_function("([r, n]) => document.querySelectorAll(r + ' .pv-grid > .pv-card').length >= n && !document.querySelector(r + ' .go-loading')",
                           arg=[root, n], timeout=60_000)
    time.sleep(0.4)


def open_board(page, base, sid, pid, sub="overview") -> None:
    page.goto(f"{base}/index.html?id={sid}&tab=recruiting&pid={pid}" + (f"&pane={sub}" if sub != "overview" else ""))
    page.wait_for_selector(".go-pane .pv-hero", timeout=120_000)
    wait_cards(page, ".go-pane")


def tab(page, root: str, sub: str) -> None:
    page.click(f"{root} .go-subtabs button[data-sub={sub}]")
    page.wait_for_selector(f"{root} .go-subtabs button[data-sub={sub}][aria-selected=true]", timeout=10_000)
    wait_cards(page, root, 1)


# ----- the board at 1280 ------------------------------------------------------------------------------------------------
def desktop(browser, base, sid, ids, profile, scheme, errs) -> None:
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, color_scheme=scheme)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    where = f"at 1280 {scheme}"
    odd, pub = ids["odd"], profile[ids["odd"]]["public"]
    open_board(page, base, sid, odd)
    # the header: five meters, Auto-Recruit; the list card and the pane line up at the top
    meters = page.eval_on_selector_all(".go-board-head .go-meter .go-meter-top span", "els => els.map(e => e.textContent)")
    assert meters == ["Recruiting Hours", "NIL Points", "Offers", "Commits", "Scouting Points"], meters
    assert page.query_selector(".go-board-head .go-auto .go-seg-btn[data-auto=week]")
    tops = page.evaluate("() => [document.querySelector('.go-list-col').getBoundingClientRect().top, document.querySelector('.go-pane').getBoundingClientRect().top]")
    assert abs(tops[0] - tops[1]) <= 1, f"the list card and the pane line up at the top {where}: {tops}"
    # the hero
    hero = page.inner_text(".go-pane .pv-hero")
    assert pub["name"] in hero and pub["height_display"] in hero and pub["weight_display"] in hero and f"#{pub['national_rank']}" in hero, hero
    assert page.inner_text(".go-pane .pv-hero .pv-pos") == pub["display_pos"] != pub["position"], "the hero shows his game position"
    stats = page.eval_on_selector_all(".go-pane .pv-stat", "els => els.map(e => [e.dataset.stat, e.querySelector('.pv-stat-v').textContent, (e.querySelector('.pv-stat-s') || {}).textContent || ''])")
    assert stats == [["nat", f"#{pub['national_rank']}", ""], ["pos", f"#{pub['pos_rank']}", pub["display_pos"]], ["class", str(pub["class_of"]), ""]], stats
    assert page.text_content(".go-pane .pv-badge .pv-kick") == "Your Chance"
    assert page.query_selector(".go-pane .pv-tabrow #rc-recruit") and page.query_selector(".go-pane .pv-tabrow .pv-star"), "Recruit ▾ and the star sit on the tab row"
    assert page.eval_on_selector_all(".go-pane .go-subtabs button", "els => els.map(e => e.textContent)") == ["Overview", "Scouting", "Profile", "History"]
    # Overview: battle and snapshot side by side, the summary across
    check_layout(page, ".go-pane", f"(Overview) {where}", [["battle", "snapshot"], ["summary"]])
    assert profile[odd]["report"]["verdict"] in page.inner_text(".go-pane [data-key=summary]")
    assert page.query_selector(".go-pane .pv-battle-row, .go-pane .pv-battle-empty") and page.query_selector(".go-pane [data-key=snapshot] .go-strip")
    title_case(page, ".go-pane .pv-kick, .go-pane .pv-row-k, .go-pane .go-subtabs button, .go-pane .pv-stat .pv-kick, .go-pane .go-kicker, .go-pane .pv-tabrow .go-btn:not(.pv-star)", where)
    shot(page, f"board-overview-1280-{scheme}")
    # Scouting: report and Attributes side by side, Looks & Uncertainty across; the comp once, in view
    tab(page, ".go-pane", "scouting")
    check_layout(page, ".go-pane", f"(Scouting) {where}", [["report", "attributes"], ["uncertainty"]])
    attrs = page.eval_on_selector_all(".go-pane .pv-attr", "els => els.map(e => [e.querySelector('.pv-attr-k').textContent, e.querySelector('.pv-attr-w').textContent, !!e.querySelector('.pv-fill')])")
    assert [a[0] for a in attrs] == ["Athleticism", "Football IQ", "Technique", "Size / Strength", "Coachability"] and all(a[2] and a[1] and a[1] != "Not Scouted" for a in attrs), attrs
    rep = profile[odd]["report"]
    assert [a[1] for a in attrs] == [" – ".join(dict.fromkeys(x["words"])) for x in rep["attributes"]], (attrs, rep["attributes"])
    assert page.evaluate("() => document.querySelectorAll('.go-pane .pv-attrs').length") == 1, "the grades show once"
    comps = page.eval_on_selector_all(".go-pane .go-comp", "els => els.filter(e => e.getClientRects().length).map(e => e.textContent)")
    our = profile[odd]["our_comp"]
    assert len(comps) == 1 and comps[0] == f"Comp: {our['name']}, {our['school']} ({our['position']}{', ' + str(our['overall']) + ' OVR' if our.get('overall') else ''})", comps
    assert our["position"] == pub["display_pos"], "the comp's position is the hero's"
    from coach_career import prospects
    assert prospects.POS_NOUNS[pub["display_pos"]] in rep["verdict"], "the verdict names his game position"
    assert "once" not in " ".join(comps).lower() and "third look" not in page.inner_text(".go-pane"), "no 'once complete' line beside the comp"
    page.hover(".go-pane .pv-attr.go-tip >> nth=0")
    time.sleep(0.3)
    assert page.query_selector(".go-pane .go-tip-box.show"), "a grade shows what it looks like on hover"
    page.mouse.move(2, 790)
    page.evaluate("() => window.scrollTo(0, 1500)")
    time.sleep(0.5)
    fit = page.evaluate("""() => { const c = [...document.querySelectorAll('.go-pane .go-comp')].find(e => e.getClientRects().length), p = document.querySelector('.go-pane');
      return { bottom: c.getBoundingClientRect().bottom, vh: innerHeight, scrolled: p.scrollTop, paneBottom: p.getBoundingClientRect().bottom }; }""")
    assert fit["bottom"] <= fit["vh"] and fit["bottom"] <= fit["paneBottom"] + 0.5 and fit["scrolled"] == 0, f"the comp is in view without scrolling the pane at 1280x800: {fit}"
    shot(page, f"board-scouting-1280-{scheme}")
    page.evaluate("() => window.scrollTo(0, 0)")
    # Profile: the traits, each known or Not Known Yet with its hint
    tab(page, ".go-pane", "profile")
    check_layout(page, ".go-pane", f"(Profile) {where}", [["traits", "background"]])
    traits = page.eval_on_selector_all(".go-pane .pv-traits .go-trait", "els => els.map(e => [e.dataset.trait, e.querySelector('.go-trait-val').textContent, (e.querySelector('.pv-hint') || {}).textContent || ''])")
    keys = [t[0] for t in traits]
    assert keys[:4] == ["decider", "cares", "personality", "story"], keys
    for k, val, hint in traits:
        if val == "Not Known Yet":
            assert hint and hint[0].isupper() and hint.endswith("."), f"an unknown trait says how it shows: {k} {hint!r}"
    assert dict((t[0], t[1]) for t in traits)["personality"] == "Not Known Yet", "his personality is not known before a call"
    # History: the timeline, the notes, the interest changes
    tab(page, ".go-pane", "history")
    check_layout(page, ".go-pane", f"(History) {where}", [["timeline", "notes"], ["interest"]])
    assert page.inner_text(".go-pane [data-key=notes] .pv-notes").strip()
    # a long timeline scrolls inside its card, and beside Recruiting Notes the card is only as tall as the notes need
    # (never under 220 px), so Recent Interest Changes stays near (the player's ask)
    tl = page.evaluate("""() => { const u = document.querySelector('.go-pane .pv-timeline'); if (!u) return null;
      for (let i = 0; i < 40; i++) u.append(u.firstElementChild.cloneNode(true));
      const card = u.closest('.pv-card'), notes = document.querySelector('.go-pane [data-key=notes]');
      const cs = getComputedStyle(u); return { oy: cs.overflowY, h: u.getBoundingClientRect().height, sh: u.scrollHeight, tab: u.tabIndex,
        card: card.getBoundingClientRect().height, notes: notes.getBoundingClientRect().height }; }""")
    if tl:
        assert tl["oy"] == "auto" and tl["sh"] > tl["h"] and tl["tab"] == 0, f"the timeline scrolls in its card: {tl}"
        assert abs(tl["card"] - tl["notes"]) <= 1 and tl["card"] >= 220, f"the timeline card is as tall as the notes card: {tl}"
        tab(page, ".go-pane", "overview")
        tab(page, ".go-pane", "history")
    no_bad_text(page, ".go-pane", where)
    no_sideways(page, where, ".go-pane")
    # the pane narrowed: the cards stack, still aligned
    page.set_viewport_size({"width": 1000, "height": 800})
    time.sleep(0.6)
    tab(page, ".go-pane", "overview")
    check_layout(page, ".go-pane", f"(narrowed) {where}", [["battle"], ["snapshot"], ["summary"]])
    no_sideways(page, f"narrowed {where}", ".go-pane")
    # a partly scouted recruit: no comp yet, said once; an unscouted one: the report asks for a scout, bars empty
    page.set_viewport_size({"width": 1280, "height": 800})
    open_board(page, base, sid, ids["part"], "scouting")
    comps = page.eval_on_selector_all(".go-pane .go-comp", "els => els.filter(e => e.getClientRects().length).map(e => e.textContent)")
    assert comps == ["Comp after his third look."], comps
    open_board(page, base, sid, ids["cold"], "scouting")
    assert page.inner_text(".go-pane [data-key=report] .pv-unscouted") == "Send a scout to read him."
    words = page.eval_on_selector_all(".go-pane .pv-attr .pv-attr-w", "els => els.map(e => e.textContent)")
    assert words == ["Not Scouted"] * 5 and not page.query_selector(".go-pane .pv-attr .pv-fill"), words
    tab(page, ".go-pane", "overview")
    assert page.inner_text(".go-pane [data-key=summary] .pv-unscouted") == "Send a scout to read him."
    ctx.close()


# ----- the popup and the Scouting Center at 1280 ------------------------------------------------------------------------
def popup_and_center(browser, base, sid, ids, profile, scheme, errs) -> None:
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme=scheme)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    where = f"at 1280 {scheme}"
    odd, pub = ids["odd"], profile[ids["odd"]]["public"]
    page.goto(f"{base}/index.html?id={sid}&tab=scouting&spid={odd}")
    page.wait_for_selector(".sc-intel .pv-hero", timeout=120_000)
    wait_cards(page, ".sc-intel")
    # the Scouting Center: header meters, the hero with Team Need and Potential, Report · Looks · Profile
    assert page.eval_on_selector_all(".sc-stats .sc-stat .sc-stat-label", "els => els.map(e => e.textContent)") == ["Scouting Points", "Trips This Week", "Board Scouted", "Full Reports"]
    assert page.inner_text(".sc-intel .pv-pos") == pub["display_pos"]
    assert [x.split(":")[0] for x in page.eval_on_selector_all(".sc-intel .pv-stat", "els => els.map(e => e.dataset.stat + ':')")] == ["nat", "pos", "need"]
    assert page.text_content(".sc-intel .pv-badge .pv-kick") == "Potential"
    assert page.eval_on_selector_all(".sc-intel .sc-subtabs button", "els => els.map(e => e.textContent)") == ["Report", "Looks", "Profile"]
    assert page.query_selector(".sc-intel .pv-tabrow #sc-send") and page.query_selector(".sc-intel .pv-tabrow #sc-board") and page.query_selector(".sc-intel .pv-tabrow .sc-full-profile")
    tops = page.evaluate("() => [document.querySelector('.sc-db').getBoundingClientRect().top, document.querySelector('.sc-intel').getBoundingClientRect().top]")
    assert abs(tops[0] - tops[1]) <= 1, f"the database and the report line up at the top {where}: {tops}"
    check_layout(page, ".sc-intel", f"(Scouting Center Report) {where}", [["report", "attributes"]])
    title_case(page, ".sc-intel .pv-kick, .sc-intel .sc-subtabs button, .sc-intel .pv-tabrow .go-btn, .sc-stat-label", where)
    shot(page, f"scouting-report-1280-{scheme}")
    tab(page, ".sc-intel", "looks")
    check_layout(page, ".sc-intel", f"(Scouting Center Looks) {where}", [["uncertainty"]])
    assert page.eval_on_selector_all(".sc-intel .pv-unc-row .pv-unc-w", "els => els.map(e => e.textContent)") == ["Low"] * 5, "a complete report is a settled read"
    tab(page, ".sc-intel", "profile")
    check_layout(page, ".sc-intel", f"(Scouting Center Profile) {where}", [["traits", "background"]])
    no_bad_text(page, "#tab-scouting", where)
    no_sideways(page, f"Scouting Center {where}")
    # the report narrowed: the cards stack, still aligned
    tab(page, ".sc-intel", "report")
    page.set_viewport_size({"width": 1000, "height": 900})
    time.sleep(0.6)
    check_layout(page, ".sc-intel", f"(Scouting Center narrowed) {where}", [["report"], ["attributes"]])
    no_sideways(page, f"Scouting Center narrowed {where}")
    page.set_viewport_size({"width": 1280, "height": 900})
    time.sleep(0.4)
    # the popup: the same hero and tabs, no Recruit menu
    tab(page, ".sc-intel", "report")
    page.click(".sc-intel .sc-full-profile")
    page.wait_for_selector(".modal:not([hidden]) .pv-popup .pv-hero", timeout=60_000)
    wait_cards(page, ".modal:not([hidden]) .pv-popup")
    m = ".modal:not([hidden]) .pv-popup"
    assert page.inner_text(f"{m} .rc-profile-name") == pub["name"] and page.inner_text(f"{m} .pv-pos") == pub["display_pos"]
    assert page.eval_on_selector_all(f"{m} .go-subtabs button", "els => els.map(e => e.dataset.sub)") == ["overview", "scouting", "profile", "history"]
    assert not page.query_selector(f"{m} #rc-recruit"), "the popup has no Recruit menu"
    assert page.get_attribute(f"{m} .pv-star", "aria-pressed") == "true", "he is on the board: the star is on"
    check_layout(page, m, f"(popup Overview) {where}", [["battle", "snapshot"], ["summary"]])
    page.click(f"{m} .go-subtabs button[data-sub=scouting]")
    wait_cards(page, m)
    check_layout(page, m, f"(popup Scouting) {where}", [["report", "attributes"], ["uncertainty"]])
    comps = page.eval_on_selector_all(f"{m} .go-comp", "els => els.map(e => e.textContent)")
    assert len(comps) == 1 and profile[odd]["our_comp"]["name"] in comps[0], comps
    no_bad_text(page, m, f"popup {where}")
    shot(page, f"popup-1280-{scheme}")
    ctx.close()


# ----- 400 px ------------------------------------------------------------------------------------------------------------
def phone(browser, base, sid, ids, scheme, errs) -> None:
    ctx = browser.new_context(viewport={"width": 400, "height": 860}, color_scheme=scheme, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    where = f"at 400 {scheme}"
    page.goto(f"{base}/index.html?id={sid}&tab=recruiting")
    page.wait_for_selector(".go-row-recruit", timeout=120_000)
    no_sideways(page, f"the list {where}")
    page.click(f".go-row-recruit[data-pid='{ids['odd']}']")
    page.wait_for_selector(".go-pane.sheet .pv-hero", timeout=30_000)
    wait_cards(page, ".go-pane")
    for sub, want in (("overview", [["battle"], ["snapshot"], ["summary"]]), ("scouting", [["report"], ["attributes"], ["uncertainty"]]),
                      ("profile", [["traits"], ["background"]]), ("history", [["timeline"], ["notes"], ["interest"]])):
        tab(page, ".go-pane", sub)
        check_layout(page, ".go-pane", f"({sub}) {where}", want)
        no_sideways(page, f"({sub}) {where}", ".go-pane")
        over = page.evaluate("""() => { const p = document.querySelector('.go-pane').getBoundingClientRect();
          return [...document.querySelectorAll('.go-pane *')].filter(e => e.getClientRects().length && !e.closest('.go-tip-box, .go-info-box') && e.getBoundingClientRect().right > p.right + 0.5).map(e => e.className).slice(0, 4); }""")
        assert not over, f"nothing runs past the pane ({sub}) {where}: {over}"
        small = page.evaluate("""() => [...document.querySelectorAll('.go-pane button, .go-pane .go-tip, .go-pane select, .go-pane input')]
          .filter(e => e.getClientRects().length && !e.closest('.go-tip-box')).map(e => [e.className, e.textContent.trim().slice(0, 20), Math.round(e.getBoundingClientRect().height)]).filter(x => x[2] < 44)""")
        assert not small, f"every control is 44 px tall ({sub}) {where}: {small}"
        if sub == "overview":
            shot(page, f"board-400-{scheme}")
    no_bad_text(page, ".go-pane", where)
    ctx.close()


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("profile overhaul skipped: Playwright is not installed")
        raise SystemExit(0)
    sid, ids = make_career()
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server = subprocess.Popen([sys.executable, "tools/dev_server.py"], cwd=ROOT, env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    errs = []
    try:
        wait_server(base)
        profile = {pid: call(base, f"/api/season/{sid}/prospect/{pid}") for pid in ids.values()}
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"profile overhaul skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            for scheme in ("dark", "light"):
                desktop(browser, base, sid, ids, profile, scheme, errs)
                popup_and_center(browser, base, sid, ids, profile, scheme, errs)
                phone(browser, base, sid, ids, scheme, errs)
            browser.close()
        assert not errs, errs
        print("profile overhaul ok: one view on the board, the popup and the Scouting Center; the game's position throughout; cards aligned at 1280, narrowed and 400, light and dark")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        server.terminate()
