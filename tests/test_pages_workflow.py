"""The GitHub Pages workflow builds the site (team data first, then dist/) and deploys dist/;
the README no longer mentions the old host."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_workflow_builds_and_deploys_dist():
    wf = (ROOT / ".github" / "workflows" / "pages.yml").read_text()
    for s in ("python -m teamdata.build_teams", "python tools/build_site.py", "actions/upload-pages-artifact", "actions/deploy-pages", "path: dist", 'python-version: "3.12"'):
        assert s in wf, s
    assert "render" not in (ROOT / "README.md").read_text().lower()


if __name__ == "__main__":
    test_workflow_builds_and_deploys_dist()
    print("ok")
