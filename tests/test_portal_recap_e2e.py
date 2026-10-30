"""The transfer portal recap in a browser: a finished career (faked as in test_offseason.py) is
taken to Development with your staff recruiting the portal on Auto, and the Development screen
shows the recap card with the players you signed, groups your transfers first in the
position-change picker, tags them in Who improved, and folds the recap to one line at the Staff
step. Needs Playwright with a Chromium; without one it is skipped with the reason. (Run as a
file.)"""
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_career_e2e import call, free_port, launch   # noqa: E402

if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("portal recap e2e skipped: Playwright is not installed")
        raise SystemExit(0)
    from coach_career import league
    from sim import season
    from test_offseason import finished
    st = season.new_season("ohio-state", "full", seed=11, career=True)
    finished(st)
    season.save_season(st)
    sid = st["id"]
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
        # to Development through the API: your staff recruit the portal (Auto) so at least one signing lands
        v = call(base, f"/api/season/{sid}/offseason")
        while v["stage"] != "portal_w1":
            v = call(base, f"/api/season/{sid}/offseason/advance", {})
        call(base, f"/api/season/{sid}/settings", {"auto_recruit": "season"})
        while v["stage"] != "development":
            v = call(base, f"/api/season/{sid}/offseason/advance", {})
        rec = v["portal_recap"]
        assert rec and rec["signed"], "seed 11 on Auto lands at least one portal signing"
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"portal recap e2e skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/index.html?id={sid}")
            page.wait_for_selector("#tab-offseason .off-steps", timeout=120_000)
            page.wait_for_selector("text=TRANSFER PORTAL RECAP", timeout=60_000)
            card = page.inner_text("#tab-offseason section.off-recap")
            assert f"You signed {len(rec['signed'])} of the {rec['entrants']} players who entered." in card, card
            for r in rec["signed"]:
                assert r["name"] in card, r["name"]
            assert ("Nobody left through the portal." in card) == (not rec["lost"])
            for r in rec["lost"]:
                assert r["name"] in card and r["to_name"] in card, r
            # the card sits above Who improved
            text = page.inner_text("#tab-offseason")
            assert text.index("TRANSFER PORTAL RECAP") < text.index("WHO IMPROVED")
            # the position-change picker groups your transfers first
            assert page.query_selector("#tab-offseason select.go-sel optgroup[label=Transfers]"), "an optgroup for the transfers"
            groups = page.eval_on_selector_all("#tab-offseason select.go-sel optgroup", "els => els.map(e => e.label)")
            assert groups == ["Transfers", "Everyone Else"], groups
            opts = page.eval_on_selector_all("#tab-offseason select.go-sel optgroup[label=Transfers] option", "els => els.map(e => e.textContent)")
            assert len(opts) >= len(rec["signed"]) and all("transfer from" in o for o in opts), opts
            # Who improved tags the transfers, in their own block and in the list
            assert "YOUR TRANSFERS" in text
            tags = page.eval_on_selector_all("#tab-offseason .go-tag", "els => els.map(e => e.textContent).filter(t => t.startsWith('Transfer'))")
            assert len(tags) >= len(rec["signed"]), tags
            # at the Staff step the recap is one line that opens on click
            page.click("text=STAFF CHANGES")
            page.wait_for_selector("text=YOUR STAFF", timeout=60_000)
            summary = page.inner_text("#tab-offseason details.off-recap summary")
            assert f"Portal: +{len(rec['signed'])} / −{len(rec['lost'])}" in summary, summary
            assert not page.eval_on_selector("#tab-offseason details.off-recap", "e => e.open")
            page.click("#tab-offseason details.off-recap summary")
            assert page.eval_on_selector("#tab-offseason details.off-recap", "e => e.open")
            assert rec["signed"][0]["name"] in page.inner_text("#tab-offseason details.off-recap")
            assert not errors, errors
            browser.close()
        print(f"portal recap e2e ok: signed {len(rec['signed'])}, lost {len(rec['lost'])}; the card, the picker, the tags, the folded line at Staff")
    finally:
        try:
            call(base, f"/api/season/{sid}", method="DELETE")
        except Exception:  # noqa: BLE001 - already gone
            pass
        league.forget(sid)
        server.terminate()
        server.wait(timeout=30)
