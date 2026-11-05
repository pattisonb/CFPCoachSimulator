"""A team pill's third color never vanishes into the page: a white accent (Alabama) borders the pill in
the theme's ink on the light theme and stays white on the dark one; a black accent (Arkansas) stays
black on the light theme and borders in the ink on the dark one. Without this the pill of a team with a
white or black third color looked like a two-color pill on half the league (web/gameview.js teamPill,
.team-pill.accent-light / .accent-dark). `python3 tests/test_pill_ring.py`"""
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

PILLS = """() => {
  const out = {};
  for (const title of ["Alabama", "Arkansas"]) {
    const el = [...document.querySelectorAll("#tab-standings .team-pill")].find((e) => e.title === title);
    out[title] = el ? { cls: el.className, border: getComputedStyle(el).borderColor, c3: el.style.getPropertyValue("--c3") } : null;
  }
  return out;
}"""


def rgb(hex_: str) -> str:
    h = hex_.lstrip("#")
    return f"rgb({int(h[0:2], 16)}, {int(h[2:4], 16)}, {int(h[4:6], 16)})"


def main() -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("pill ring test skipped: Playwright is not installed")
        return
    from sim import season
    st = season.new_season("alabama", "full", seed=3, career=True)   # the SEC standings hold both teams
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
                print(f"pill ring test skipped: no Chromium for Playwright ({str(exc).splitlines()[0]})")
                return
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.goto(f"{base}/index.html?id={st['id']}&tab=standings")
            page.wait_for_selector("#season:visible")
            page.wait_for_selector("#tab-standings .team-pill", timeout=120_000)
            seen = {}
            for theme in ("light", "dark"):
                page.evaluate(f"document.documentElement.dataset.theme = '{theme}'")
                ink = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--text').trim()")
                pills = page.evaluate(PILLS)
                assert pills["Alabama"] and pills["Arkansas"], pills
                bama, hogs = pills["Alabama"], pills["Arkansas"]
                assert "accent-light" in bama["cls"] and "accent-dark" in hogs["cls"], pills
                if theme == "light":
                    assert bama["border"] == rgb(ink), (theme, bama, ink)          # white would vanish: the ink instead
                    assert hogs["border"] == rgb(hogs["c3"]), (theme, hogs)        # black reads on the light page
                else:
                    assert bama["border"] == rgb(bama["c3"]), (theme, bama)        # white reads on the dark page
                    assert hogs["border"] == rgb(ink), (theme, hogs, ink)          # black would vanish: the ink instead
                seen[theme] = (bama["border"], hogs["border"])
            browser.close()
        print(f"pill ring ok: Alabama (white accent) borders {seen['light'][0]} on light and {seen['dark'][0]} on dark; "
              f"Arkansas (black accent) borders {seen['light'][1]} on light and {seen['dark'][1]} on dark")
    finally:
        server.terminate()
        season.close_pool()
        for path in (ROOT / "data" / "seasons").glob(f"{st['id']}*"):
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
