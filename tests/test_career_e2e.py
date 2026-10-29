"""Coach Career end to end in a browser: a career played from week 0 to national signing day on
Auto-recruit, then downloaded, deleted from the server and loaded back from the file with its
signed class intact. Needs Playwright with a Chromium; without one it is skipped with the reason.
(Run as a file: multiprocessing on Windows.)"""
import glob
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def call(base: str, path: str, body=None, method=None):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"},
                                 method=method or ("POST" if body is not None else "GET"))
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def signed_with(base: str, sid: str, team: str) -> list[str]:
    """The school's signed class (the classes view: during the portal weeks the Prospects tab is the transfer pool)."""
    rows = call(base, f"/api/season/{sid}/classes?school={team}")["class"]
    return sorted(r["id"] for r in rows if r.get("signed") == team)


def launch(p):
    """Playwright's own Chromium, else one installed beside it (CI images, PLAYWRIGHT_BROWSERS_PATH)."""
    try:
        return p.chromium.launch()
    except Exception as first:  # noqa: BLE001 - try the installed builds before giving up
        roots = [os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or "", "/opt/pw-browsers"]
        for exe in sorted(e for r in roots if r for e in glob.glob(f"{r}/chromium-*/chrome-linux/chrome")):
            try:
                return p.chromium.launch(executable_path=exe)
            except Exception:  # noqa: BLE001
                continue
        raise first


if __name__ == "__main__":
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("career e2e skipped: Playwright is not installed")
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
        team = "georgia"
        sid = call(base, "/api/season", {"team": team, "mode": "full", "career": True, "seed": 31})["id"]
        call(base, f"/api/season/{sid}/settings", {"auto_recruit": True})
        with sync_playwright() as p:
            try:
                browser = launch(p)
            except Exception as exc:  # noqa: BLE001
                print(f"career e2e skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                raise SystemExit(0)
            page = browser.new_page(accept_downloads=True)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/season?id={sid}")
            page.wait_for_selector("#season:visible")
            page.wait_for_selector(".go-play")                 # a career opens on the Office
            # a week highlighted on the schedule is not the Office's Advance target: it plays one week
            page.click("#season-tabs button[data-tab=schedule]")
            page.click("#week-strip button.week-chip[aria-label='Week 4']")
            page.click("#season-tabs button[data-tab=office]")
            page.wait_for_selector(".go-play")
            page.click(".go-play >> text=/Sim the week|ADVANCE THE WEEK/")
            for _ in range(600):
                if call(base, f"/api/season/{sid}/status?since=0")["status"] != "running" and call(base, f"/api/season/{sid}")["current_week"] >= 1:
                    break
                time.sleep(0.5)
            assert call(base, f"/api/season/{sid}")["current_week"] == 1, call(base, f"/api/season/{sid}")["current_week"]
            page.click(".go-play >> text=Sim to the end")
            page.wait_for_function("() => /Season complete|national champion/.test(document.querySelector('#season-meta').textContent)",
                                   timeout=900_000)
            summary = call(base, f"/api/season/{sid}")
            assert summary["done"] and summary["current_week"] == 20
            # the committee's final ranking leads the Rankings tab after the season (it does not vanish)
            page.click("#season-tabs button[data-tab=rankings]")
            page.wait_for_selector("#poll-body table")
            assert page.eval_on_selector("#poll-pills button.active", "b => b.dataset.poll") == "cfp"
            assert "Final ranking" in page.inner_text("#poll-body")
            signed = signed_with(base, sid, team)
            spots = call(base, f"/api/season/{sid}/recruiting")["open_spots"]
            assert 0 < len(signed) <= spots, (len(signed), spots)
            # download, forget, load back
            with page.expect_download() as dl:
                page.click("#btn-download-career")
            path = Path(tempfile.mkdtemp()) / "career.ccsave"
            dl.value.save_as(str(path))
            call(base, f"/api/season/{sid}", method="DELETE")
            try:
                call(base, f"/api/season/{sid}")
                raise AssertionError("the server still had the career")
            except urllib.error.HTTPError as e:
                assert e.code == 404
            page.goto(f"{base}/season")
            page.set_input_files("#career-file", str(path))
            page.wait_for_function("() => /Loaded the/.test(document.querySelector('#toast').textContent)", timeout=120_000)
            assert signed_with(base, sid, team) == signed, "the signed class changed on the way back"
            page.click("#season-tabs button[data-tab=recruiting]")
            page.wait_for_selector(".rc-head")
            assert not errors, errors
            browser.close()
        print(f"career e2e ok: {team} signed {len(signed)} of {spots} spots; the class came back from the file")
    finally:
        if sid:
            try:
                call(base, f"/api/season/{sid}", method="DELETE")
            except Exception:  # noqa: BLE001 - already gone
                pass
        server.terminate()
        server.wait(timeout=30)
