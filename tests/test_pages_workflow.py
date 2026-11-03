"""The GitHub Pages workflow builds the site (team data first, then dist/) and deploys dist/;
vercel.json builds the same dist/ for the main site and its previews; the README no longer
mentions the old host."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_workflow_builds_and_deploys_dist():
    wf = (ROOT / ".github" / "workflows" / "pages.yml").read_text()
    for s in ("python -m teamdata.build_teams", "python tools/build_site.py", "actions/upload-pages-artifact", "actions/deploy-pages", "path: dist", 'python-version: "3.12"'):
        assert s in wf, s
    assert "render" not in (ROOT / "README.md").read_text().lower()


def test_vercel_builds_dist():
    cfg = json.loads((ROOT / "vercel.json").read_text())
    assert cfg["framework"] is None    # not auto-detected as a Python app (requirements.txt is for the tests)
    assert cfg["buildCommand"] == "python3 -m teamdata.build_teams && python3 tools/build_site.py"
    assert cfg["outputDirectory"] == "dist"
    assert "cfp-coach-simulator.vercel.app" in (ROOT / "README.md").read_text()


if __name__ == "__main__":
    test_workflow_builds_and_deploys_dist()
    test_vercel_builds_dist()
    print("ok")
