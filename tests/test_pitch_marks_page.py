"""Pitch marks on the page: a prospect you pitched shows what he said on each topic, on his card and in the lead-with
pill (He Lit Up, Weak Case, Not His Thing, No Read); a topic never pitched has no mark. Needs Playwright with a
Chromium; skipped without one. (Run as a file.)"""
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import free_port, launch   # noqa: E402

if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("pitch marks page test skipped: Playwright is not installed")
        raise SystemExit(0)
    from sim import season
    st = season.new_season("iowa", "full", seed=5, career=True)
    rc = st["recruiting"]
    pid = next(q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[30:] if not rc["prospects"][q].get("hidden"))
    rc["board"].append(pid)
    for topic, reaction in (("nil", "polite"), ("coach", "quiet"), ("winning", "hit"), ("pro", "guarded")):
        rc["log"].append({"week": 1, "kind": "pitch", "pid": pid, "school": "iowa", "action": "call", "pitch": topic, "reaction": reaction})
    rc["revealed"].setdefault("iowa", {})[pid] = list(rc["prospects"][pid]["priorities"][:2])   # he told you two of his priorities
    season.save_season(st)
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
                print(f"pitch marks page test skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            for width in (1280, 400):
                page = browser.new_page(viewport={"width": width, "height": 900})
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(f"{base}/index.html?id={st['id']}&tab=recruiting")
                page.wait_for_selector(f".go-row-recruit[data-pid='{pid}']", timeout=120_000)
                page.click(f".go-row-recruit[data-pid='{pid}']")
                time.sleep(0.5)
                card = page.eval_on_selector_all(".go-pane .go-mark", "els => els.map(e => [e.textContent, e.getAttribute('title')])")
                texts = [c[0] for c in card]
                assert any("Not His Thing" in t for t in texts) and any("Weak Case" in t for t in texts), card
                assert all(c[1] and c[1].endswith(".") for c in card), "each mark says why, as a sentence"
                # What He Wants: his known priorities, each with your program's case in a word (School Grades Phase 2)
                page.click(".go-pane .go-subtabs button[data-sub=profile]")
                page.wait_for_selector(".go-pane [data-trait=wants]", timeout=30_000)
                wants = page.eval_on_selector_all(".go-pane [data-trait=wants] .go-want", "els => els.map(e => [e.querySelector('b').textContent, (e.querySelector('.go-tag') || {}).textContent])")
                assert len(wants) == 2 and all(w[1] in ("Strong", "Fair", "Weak") for w in wants), wants
                page.click("#rc-recruit")
                page.click(".go-menu .go-menu-item[data-action=message]")
                page.wait_for_selector(".go-pane .go-step #rc-pitch")
                time.sleep(0.3)
                assert page.evaluate("() => document.activeElement && document.activeElement.classList.contains('go-lead-pick')"), "the step's focus lands on the lead-with pill"
                assert page.is_hidden(".go-pane .go-step .go-lead-menu"), "the lead-with sits closed in one pill"
                page.click(".go-pane .go-step .go-lead-pick")
                opts = dict(page.eval_on_selector_all(".go-pane .go-step .go-lead-chip", "els => els.map(e => [e.dataset.topic, e.textContent])"))
                assert "Not His Thing" in opts["nil"] and "Weak Case" in opts["coach"] and "He Lit Up" in opts["winning"] and "No Read" in opts["pro"], opts
                assert not any(w in opts["prestige"] for w in ("Not His Thing", "Weak Case", "He Lit Up", "No Read")), "never pitched: no mark"
                # Promise Him the Job's History lines: no "undefined" when nobody was ahead; a strain says what he heard
                lines = page.evaluate("""() => window.Recruiting.parts.historyLines([
                  {week: 3, kind: "answer", answer: "promise", job: true, truthful: true, pid: "x", school: "iowa", line: "You told him the job is his."},
                  {week: 4, kind: "answer", answer: "promise", job: true, truthful: true, crowded: true, about: "Old Guy", pid: "x", school: "iowa"},
                  {week: 5, kind: "promise_strained", pid: "x", school: "iowa", line: "Coach, I heard you told another kid the same thing."}], "iowa")""")
                joined = " | ".join(lines)
                assert "undefined" not in joined and "promise_strained" not in joined, lines
                assert any("Promised him the job" in l and "did not buy it" not in l for l in lines[:1]) or any(l.endswith("Promised him the job") for l in lines), lines
                assert any("did not buy it" in l for l in lines), lines
                assert any("I heard you told another kid the same thing." in l for l in lines), lines
                text = page.inner_text("body")
                for bad in ("null", "undefined", "NaN"):
                    assert bad not in text, bad
                assert not errors, errors
                page.close()
            browser.close()
    finally:
        server.terminate()
    print("pitch marks page ok: the card and the lead-with show what he said; a topic never pitched has no mark; 1280 and 400")
