"""Build the static site for the browser (docs/superpowers/specs/2026-10-29-client-side-runtime-design.md,
sections 7 and 8): `dist/` holds the page (`web/`), `game.zip` (the Python
game and the data a career reads, unpacked by Pyodide into its in-memory filesystem), `version.json`
(the commit) and `.nojekyll`.

    python tools/build_site.py

The first offseason's league comes precomputed (league.write_base_files writes data/base_league.json
and data/base_meta.json first), so the 146 source rosters stay out of the zip; only the eight
fictional teams' files ship, for their stand-in rosters.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from coach_career import league  # noqa: E402

PACKAGES = ("engine", "sim", "coach_career", "teamdata", "app")     # their .py files only
# the data a career reads through a season, its offseason and the next season's first week
DATA_FILES = (
    "data/engine_teams.json", "data/player_potential.json", "data/recruiting_model.json", "data/history/polls.json",
    "data/schedules.json", "data/schedule_rules.json", "data/series.json", "data/rivalries.json", "data/bowls.json",
    "data/fcs_map.json", "data/game_scale.json", "data/observed_tendencies.json", "data/manual_ratings.json",
    "data/scheme_overrides.json", "data/poll_params.json", "data/program_history.json", "data/program_market.json",
    "data/real_adjustments.json", "data/coach_birth_years.json", "data/draft_targets.json",
    "data/base_league.json", "data/base_meta.json",
    "cfb_sim_data/coaches.json", "cfb_sim_data/teams_index.json", "cfb_sim_data/league.json",
)


def _game_files() -> list[str]:
    """Every path game.zip holds, relative to the project root."""
    files = []
    for pkg in PACKAGES:
        files += sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / pkg).rglob("*.py") if "__pycache__" not in p.parts)
    missing = [f for f in DATA_FILES if not (ROOT / f).is_file()]
    if missing:
        raise FileNotFoundError(f"missing data files for the bundle: {', '.join(missing)}")
    files += DATA_FILES
    fictional = [s for s in league.base_slugs() if league.base_meta(s)["fictional"]]
    files += [f"cfb_sim_data/teams/{s}.json" for s in fictional]
    return files


def _commit() -> str:
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return "dev"
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else "dev"


def build(out: Path = ROOT / "dist") -> dict:
    """Write the site to `out` (wiped first): {"zip_bytes": game.zip's size, "files": its paths}."""
    league.write_base_files()
    league.base_meta.cache_clear()
    league.base_slugs.cache_clear()
    out = Path(out)
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    web = ROOT / "web"
    for p in sorted(web.rglob("*")):
        if p.is_file() and "__pycache__" not in p.parts:
            dest = out / p.relative_to(web)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, dest)
    files = _game_files()
    with zipfile.ZipFile(out / "game.zip", "w", compression=zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(ROOT / f, f)
    (out / "version.json").write_text(json.dumps({"commit": _commit()}), encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")
    return {"zip_bytes": (out / "game.zip").stat().st_size, "files": files}


if __name__ == "__main__":
    info = build()
    print(f"dist/: game.zip {info['zip_bytes'] / 1e6:.1f} MB, {len(info['files'])} files")
