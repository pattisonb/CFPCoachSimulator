"""The offseason's order (offseason.py, web/offseason.js): Keep Them Home comes first, then Departures.
Who wants out (graduating, declaring early, entering the portal) is decided when the offseason opens;
the draft runs only after your answers at Keep Them Home and the AI schools' own, so a player you kept
is never drafted and The First Round is the final pool's. A save from the older order (Departures
first, the draft already shown) still loads and carries on. The browser part checks the stepper and
the two pages (screenshots to SHOT_DIR when it is set); without Playwright it is skipped.
`python3 tests/test_offseason_order.py`"""
import copy
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from coach_career import offseason   # noqa: E402
from sim import season   # noqa: E402
from test_offseason import finished   # noqa: E402

FBS_PICKS = round(offseason.DRAFT_PICKS * offseason.DRAFT_FROM_FBS)


def fresh(team: str = "ohio-state", seed: int = 5) -> dict:
    st = season.new_season(team, "full", seed=seed, career=True)
    finished(st)
    offseason.start(st)
    return st


def check_draft(st: dict, kept: set) -> None:
    """The draft as it ran: picks 1..N once each, by stored score over the final pool, nobody kept in it."""
    off = st["offseason"]
    deps = off["departures"]
    scores = off["draft"]["scores"]
    drafted = sorted((d for d in deps if d["kind"] == "draft"), key=lambda d: d["pick"])
    assert [d["pick"] for d in drafted] == list(range(1, len(drafted) + 1)), "the picks skip or repeat"
    assert len(drafted) == FBS_PICKS, len(drafted)
    assert all(d["round"] == min(7, (d["pick"] - 1) // 32 + 1) for d in drafted)
    assert not any(d["kind"] == "declared" for d in deps), "an early entrant was left waiting for the draft"
    assert not ({d["id"] for d in deps if d["kind"] in ("draft", "undrafted")} & kept), "a player you kept was drafted"
    ss = [scores[d["id"]] for d in drafted]
    assert ss == sorted(ss, reverse=True), "the picks are not in draft-score order"
    last = ss[-1]
    for d in deps:                          # everyone left in the pool undrafted scores under the last pick
        if d["id"] in scores and d["kind"] in ("undrafted", "graduated"):
            assert scores[d["id"]] <= last, (d["name"], d["kind"])
    v = offseason.view(st)
    assert v["departures"]["first_round"] == drafted[:32], "The First Round is not the final draft"
    assert v["departures"]["league"].get("draft") == FBS_PICKS
    assert v["departures"]["early_entrants"] == sum(1 for d in deps if d.get("early"))


def order_and_draft() -> None:
    assert offseason.STAGES[:2] == ("retention", "departures"), offseason.STAGES
    st = fresh()
    off = st["offseason"]
    me = st["team"]
    assert off["stage"] == "retention", off["stage"]
    v = offseason.view(st)
    assert [s["key"] for s in v["stages"]][:2] == ["retention", "departures"] and v["stages"][0]["current"]
    assert v["review_open"], "the AD's meeting is open at the first step"
    # nothing is drafted yet: early entrants wait as declared, The First Round is empty
    assert not any(d["kind"] in ("draft", "undrafted") for d in off["departures"]), "drafted before Keep Them Home"
    assert v["departures"]["first_round"] == [] and not off["draft"]["done"]
    assert any(d["kind"] == "declared" for d in off["departures"])
    # your early entrants and portal entrants wait at Keep Them Home, with a projected pick
    ret = off["retention"]["players"]
    entrants = [e for e in ret if e["intent"] == "draft"]
    assert entrants and all(e["draft_pick"] or e["draft_kind"] == "undrafted" for e in entrants), entrants
    # keep one early entrant (forced: the odds are tested in test_retention) and let the rest go
    keep = entrants[-1]["id"]
    real = offseason.stay_chance
    offseason.stay_chance = lambda e, state=None: 1.0 if e["id"] == keep else 0.0
    try:
        offseason.advance(st)
    finally:
        offseason.stay_chance = real
    assert off["stage"] == "departures", off["stage"]
    assert any(p["id"] == keep for p in st["league"]["teams"][me]["roster"]), "the kept player is off the roster"
    check_draft(st, {keep})
    v = offseason.view(st)
    stayed = v["departures"]["stayed"]
    assert [s["id"] for s in stayed] == [keep] and stayed[0]["kind_name"] == "Stayed: You Kept Him Home", stayed
    assert all(d["id"] != keep for d in v["departures"]["mine"])
    gone = {e["id"] for e in entrants} - {keep}
    assert gone <= {d["id"] for d in v["departures"]["mine"] if d["kind"] in ("draft", "undrafted")}, "an early entrant who left is not in the draft"
    # redshirts and position changes are still Departures' (Your Roster)
    rs = off["redshirts"]
    if rs["players"]:
        offseason.redshirt(st, rs["players"][0]["id"], not rs["players"][0]["redshirt"])
    offseason.advance(st)
    assert off["stage"] == "portal_w1", off["stage"]
    assert off["redshirts"]["decided"]
    # the whole offseason on Auto runs the same order to the end
    st2 = season.new_season("smu", "full", seed=6, career=True)
    finished(st2)
    offseason.run_all(st2)
    check_draft(st2, {r["id"] for r in st2["offseason"]["retention"]["results"] if r["status"] == "stayed"})
    print("  order: Keep Them Home, then Departures; the draft runs after the answers")


def legacy(st: dict, stage: str) -> dict:
    """A save as the older order wrote it: the draft already run at the start (everyone who declared in
    it, your early entrants waiting with their projected pick), no draft block, the stage given."""
    st = copy.deepcopy(st)
    off = st["offseason"]
    scores = off["draft"]["scores"]
    pool = [d for d in off["departures"] if d["id"] in scores and d["kind"] in ("graduated", "declared")]
    mine = [e for e in off["retention"]["players"] if e["intent"] == "draft"]
    order = sorted([(scores[d["id"]], "dep", d) for d in pool] + [(scores[e["id"]], "ret", e) for e in mine], key=lambda x: -x[0])
    for pick, (_, kind, x) in enumerate(order, 1):
        drafted = pick <= FBS_PICKS
        if kind == "dep":
            x.pop("proj", None)
            if drafted:
                x.update(kind="draft", pick=pick, round=min(7, (pick - 1) // 32 + 1))
            elif x["kind"] == "declared":
                x["kind"] = "undrafted"
        else:
            x.update(draft_pick=pick if drafted else None, draft_kind="draft" if drafted else "undrafted")
            x.pop("elite", None)
    del off["draft"]
    off["stage"] = stage
    if stage == "retention":                         # the older order had decided the AD and the redshirts at Departures
        off["review"]["decided"] = True
        off["redshirts"]["decided"] = True
    return st


def old_saves() -> None:
    base = fresh("georgia", 8)
    me = base["team"]
    # an old save at Departures (the draft on screen, Keep Them Home still to come)
    st = legacy(base, "departures")
    assert any(d["kind"] == "draft" for d in st["offseason"]["departures"])
    v = offseason.view(st)                           # loading it migrates it
    off = st["offseason"]
    assert off["stage"] == "retention" and v["stage"] == "retention", off["stage"]
    assert off["draft"]["legacy"] and not off["draft"]["done"]
    assert not any(d["kind"] in ("draft", "undrafted") for d in off["departures"]), "the old draft still shows before Keep Them Home"
    assert offseason.view(st) == v, "migrating twice changed the save"
    offseason.advance(st)
    assert off["stage"] == "departures"
    check_draft(st, {r["id"] for r in off["retention"]["results"] if r["status"] == "stayed"})
    offseason.advance(st)
    assert off["stage"] == "portal_w1", off["stage"]
    # an old save at Keep Them Home (Departures done, the draft shown): it resolves, the draft reruns, Departures next
    st = legacy(base, "retention")
    offseason.view(st)
    off = st["offseason"]
    assert off["stage"] == "retention"
    offseason.advance(st)
    assert off["stage"] == "departures"
    check_draft(st, {r["id"] for r in off["retention"]["results"] if r["status"] == "stayed"})
    assert off["redshirts"]["decided"]
    offseason.advance(st)
    assert off["stage"] == "portal_w1"
    # an old save past both: nothing to redo
    st = legacy(base, "retention")
    st["offseason"]["stage"] = "portal_w2"
    before = copy.deepcopy(st["offseason"]["departures"])
    offseason.view(st)
    assert st["offseason"]["departures"] == before and st["offseason"]["draft"]["done"]
    assert me
    print("  old saves: Departures-first saves migrate to Keep Them Home, then a rerun draft")


def browser() -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  browser skipped: Playwright is not installed")
        return
    from coach_career import league
    from test_career_e2e import call, free_port, launch
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(st)
    season.save_season(st)
    sid = st["id"]
    shots = os.environ.get("SHOT_DIR")
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
                b = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"  browser skipped: no Chromium ({str(exc).splitlines()[0]})")
                return
            page = b.new_page(viewport={"width": 1280, "height": 900}, color_scheme="dark")
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script("try { localStorage.setItem('cfp.theme', 'dark'); } catch (e) {}")
            page.goto(f"{base}/index.html?id={sid}")
            page.wait_for_selector("#tab-offseason .off-page[data-page=hub]", timeout=180_000)
            names = page.eval_on_selector_all("#tab-offseason .off-step-name", "ns => ns.map((n) => n.textContent)")
            assert names[:2] == ["Keep Them Home", "Departures"], names
            assert "Stage 1 of 9" in page.inner_text("#tab-offseason .off-chip")
            prim = lambda: page.inner_text("#tab-offseason .off-foot .go-btn.primary")   # noqa: E731
            assert prim() == "Advance to Keep Them Home", prim()
            assert page.query_selector("#tab-offseason .off-review-acts") or call(base, f"/api/season/{sid}/offseason")["review"]["decided"]
            page.click("#tab-offseason .off-foot .go-btn.primary")
            page.wait_for_selector("#tab-offseason .off-page[data-page=retention]", timeout=60_000)
            assert page.eval_on_selector("#tab-offseason .off-step.now .off-step-name", "n => n.textContent") == "Keep Them Home"
            text = page.inner_text("#tab-offseason")
            assert "Projected Pick" in text or "projected pick" in text, "the early entrants' projections are missing"
            assert "1 in 50" in text, "the elite entrant's odds are not stated"
            assert prim() == "Advance to Departures", prim()
            if shots:
                Path(shots).mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(Path(shots) / "1-keep-them-home-1280-dark.png"), full_page=True)
            v = call(base, f"/api/season/{sid}/offseason")
            if not v["review"]["decided"]:
                call(base, f"/api/season/{sid}/offseason/review", {"action": "nothing", "stage": "retention"})
            page.click("#tab-offseason .off-foot .go-btn.primary")
            page.wait_for_selector("#tab-offseason .off-page[data-page=departures]", timeout=120_000)
            page.wait_for_function("() => !document.querySelector('#tab-offseason .off-busy')", timeout=120_000)
            v = call(base, f"/api/season/{sid}/offseason")
            assert v["stage"] == "departures"
            steps = page.eval_on_selector_all("#tab-offseason .off-step", "ns => ns.map((n) => n.className)")
            assert "done" in steps[0] and "now" in steps[1], steps
            assert "Stage 2 of 9" in page.inner_text("#tab-offseason .off-chip")
            first = page.inner_text("#tab-offseason .off-first")
            assert v["departures"]["first_round"][0]["name"] in first, first
            assert prim() == "Advance to Transfer Portal (Week 1)", prim()
            if shots:
                page.screenshot(path=str(Path(shots) / "2-departures-1280-dark.png"), full_page=True)
            assert not errors, errors
            b.close()
        print("  browser: the stepper reads Keep Them Home, then Departures")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001
            pass
        league.forget(sid)
        server.terminate()
        server.wait(timeout=30)


if __name__ == "__main__":
    order_and_draft()
    old_saves()
    browser()
    print("offseason order ok")
