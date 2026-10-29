"""The site is served from a project subpath (GitHub Pages), so every page URL is relative,
and the server-era modes (Sim a game, Real 2026, Start from today, device backups) are gone."""
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
# not URLs: the worker's paths in Pyodide's in-memory filesystem
FS_PATHS = {"worker.js": {"/home/pyodide", "/data/seasons", "/data/coaches"}}


def test_no_root_absolute_urls():
    bad = []
    for f in WEB.glob("*.html"): bad += re.findall(r'(?:href|src)="/(?!/)', f.read_text())
    for f in WEB.glob("*.js"):   bad += [m for m in re.findall(r'["\'`](/(?!api/)[a-z][^"\'`]*)["\'`]', f.read_text())
                                         if m not in FS_PATHS.get(f.name, ())]
    bad += re.findall(r'"/(?!api/)', (WEB / "manifest.json").read_text())
    assert not bad, bad


def test_removed_modes_gone():
    assert not (WEB / "app.js").exists()
    for f in ("index.html", "coach.html"):
        t = (WEB / f).read_text()
        assert "Sim a game" not in t and "Real 2026" not in t and "Start from today" not in t and "btn-today" not in t
    assert "X-CFP-Browser" not in (WEB / "season.js").read_text() and "indexedDB" not in (WEB / "careersave.js").read_text()


if __name__ == "__main__":
    test_no_root_absolute_urls()
    test_removed_modes_gone()
    print("ok")
