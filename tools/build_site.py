"""Build the published site: the React app (`ui/`) with the Python game packed beside it, to `ui/dist/`.

    python tools/build_site.py              # the real rosters, as `npm run dev` shows them
    python tools/build_site.py --generic    # every real name swapped for a lookalike (tools/generic)

Vercel runs this (vercel.json) and always builds generic: there VERCEL=1 turns `--generic` on by itself, so nothing
published carries a real school, bowl, player or coach name. Nothing in the repository is changed: the game and the
app are copied to a scratch folder, the names are swapped there, and the build reads the copy.

What lands in `ui/dist/`: the app (vite build, with VITE_GAME=browser so it talks to the worker instead of a
server), `worker.js` (Pyodide runs the game's dispatcher, app/api.py), `engine.js` (the game engine, engine_js/ as one
file: the workers load it and the Python calls it), `game.tar.xz` (the Python game and the data a
career reads), `boot/` (the team picker's answers worked out ahead, so the first screen shows before Python has
loaded: `boot/teams.json` and one `boot/teams/<slug>.json` a team) and `version.json` (the commit).

The first offseason's league comes precomputed (league.write_base_files writes data/base_league.json and
data/base_meta.json, and data/base_development.json for the Depth Chart's first read), so the 146 source rosters
stay out of the archive; only the fictional teams' files ship.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

PACKAGES = ("sim", "coach_career", "teamdata", "app")     # their .py files only
ENGINE = "engine_js"       # the game engine, which is JavaScript: bundled into one file the workers load (engine.js)
JS_DIRS = (ENGINE, "sim_js", "teamdata_js", "career_js")    # the game's JavaScript so far (the engine and what has been ported onto it)
# the data a career reads through a season, its offseason and the next season's first week
DATA_FILES = (
    "data/engine_teams.json", "data/player_potential.json", "data/recruiting_model.json", "data/history/polls.json",
    "data/schedules.json", "data/schedule_rules.json", "data/series.json", "data/rivalries.json", "data/bowls.json",
    "data/fcs_map.json", "data/game_scale.json", "data/observed_tendencies.json", "data/manual_ratings.json",
    "data/scheme_overrides.json", "data/poll_params.json", "data/program_history.json", "data/program_market.json",
    "data/program_profile.json", "data/real_adjustments.json", "data/coach_birth_years.json", "data/draft_targets.json",
    "data/major_cities.json", "data/base_league.json", "data/base_meta.json", "data/base_development.json",
    "cfb_sim_data/coaches.json", "cfb_sim_data/league.json",
)
GENERATED = ("data/engine_teams.json", "data/player_potential.json", "data/base_league.json", "data/base_meta.json",
             "data/base_development.json")
ARCHIVE = "game.tar.xz"   # what ui/public/worker.js downloads and unpacks
ARCHIVE_PRESET = 6      # *tune* how hard xz packs the game, 0 to 9: higher is a slightly smaller download and a slower build
UI_SKIP = ("node_modules", "dist")      # never copied with the app's source


def _commit() -> str:
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return "dev"
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else "dev"


def _run(cmd: list[str], cwd: Path, env: dict | None = None) -> None:
    subprocess.run(cmd, cwd=cwd, check=True, env={**os.environ, **(env or {})})


def stage(work: Path, generic: bool, ui: bool = True) -> Path:
    """Copy the game (and the app's source) to `work`, swap the names there when `generic`, and build the data the
    game reads (engine teams, the base league). Returns the staged project root."""
    root = work / "project"
    for pkg in PACKAGES:
        shutil.copytree(ROOT / pkg, root / pkg, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    # the preset faces go with the rosters (the player's ask): a face file holds face parts only, keyed by player id
    # and coach name, and a generic build's scrub renames those keys and the file with everything else
    shutil.copytree(ROOT / "cfb_sim_data", root / "cfb_sim_data")
    for d in JS_DIRS:                                   # the staged Python asks it for games too (sim/engine.py, through Node)
        shutil.copytree(ROOT / d, root / d)
    (root / "data" / "history").mkdir(parents=True)
    for p in sorted((ROOT / "data").glob("*.json")):
        if f"data/{p.name}" not in GENERATED:
            shutil.copy2(p, root / "data" / p.name)
    shutil.copy2(ROOT / "data" / "history" / "polls.json", root / "data" / "history" / "polls.json")
    if ui:
        shutil.copytree(ROOT / "ui", root / "ui", ignore=shutil.ignore_patterns(*UI_SKIP))
        shutil.copytree(ROOT / "pocket-faces", root / "pocket-faces", ignore=shutil.ignore_patterns(*UI_SKIP))   # the app reads it as source
    if generic:
        from tools.generic import scrub
        scrub.run(root)
    _run([sys.executable, "-m", "teamdata.build_teams"], root)
    _run([sys.executable, "-c", "from coach_career import league; league.write_base_files()"], root)
    return root


def game_files(root: Path) -> list[str]:
    """Every path the game archive holds, relative to the staged project root."""
    files = []
    for pkg in PACKAGES:
        files += sorted(p.relative_to(root).as_posix() for p in (root / pkg).rglob("*.py"))
    missing = [f for f in DATA_FILES if not (root / f).is_file()]
    if missing:
        raise FileNotFoundError(f"missing data files for the bundle: {', '.join(missing)}")
    files += DATA_FILES
    meta = json.loads((root / "data" / "base_meta.json").read_text(encoding="utf-8"))
    files += [f"cfb_sim_data/teams/{s}.json" for s in sorted(meta) if meta[s].get("fictional")]
    files += sorted(p.relative_to(root).as_posix() for p in (root / "cfb_sim_data" / "faces").glob("*.json"))
    return files


def write_archive(root: Path, dest: Path) -> list[str]:
    """The game as one xz-packed tar: a little over half the size a zip of the same files is (the rosters are mostly
    numbers, which xz packs far better), for about half a second more unpacking in the browser."""
    files = game_files(root)
    with tarfile.open(dest, "w:xz", preset=ARCHIVE_PRESET) as z:
        for f in files:
            z.add(root / f, f)
    return files


BOOT = """
import json, sys
from pathlib import Path
from app import api
out = Path(sys.argv[1])
(out / "teams").mkdir(parents=True)
teams = api.call("GET", "/api/teams")
(out / "teams.json").write_text(json.dumps(teams, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
for t in teams["teams"]:
    detail = api.call("GET", "/api/teams/" + t["slug"])
    (out / "teams" / (t["slug"] + ".json")).write_text(json.dumps(detail, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
"""


def write_boot(root: Path, dest: Path, scratch: Path) -> int:
    """The team picker's answers, asked of the staged game once and written as plain files (`dest`/teams.json and
    `dest`/teams/<slug>.json): the page reads these until the game in the browser is up (ui/src/gameClient.ts), and a
    game just started gives the same answers. Returns how many teams were written."""
    shutil.rmtree(dest, ignore_errors=True)
    _run([sys.executable, "-c", BOOT, str(dest)], root,
         {"CFP_SEASONS_DIR": str(scratch / "boot-seasons"), "SIM_WORKERS": "1", "PYTHONPATH": str(root)})
    return len(list((dest / "teams").glob("*.json")))


def build(out: Path = ROOT / "ui" / "dist", generic: bool = False) -> dict:
    """Write the site to `out` (wiped first): {"archive_bytes": the game archive's size, "files": its paths}."""
    out = Path(out)
    commit = _commit()
    with tempfile.TemporaryDirectory(prefix="cfp-site-") as tmp:
        root = stage(Path(tmp), generic)
        ui = root / "ui"
        modules = ROOT / "ui" / "node_modules"
        if not modules.is_dir():
            raise FileNotFoundError("ui/node_modules is missing: run `npm ci` in ui/ first")
        (ui / "node_modules").symlink_to(modules, target_is_directory=True)
        npx = "npx.cmd" if os.name == "nt" else "npx"
        _run([npx, "vite", "build"], ui, {"VITE_GAME": "browser", "VITE_GAME_VERSION": commit})
        shutil.rmtree(out, ignore_errors=True)
        shutil.copytree(ui / "dist", out)
        files = write_archive(root, out / ARCHIVE)
        # the engine as one plain script (no comments: they are the only place it names a school), for worker.js and
        # sim-worker.js to load beside Python
        _run([npx, "esbuild", str(root / ENGINE / "api.js"), "--bundle", "--format=iife", "--global-name=EngineJS", "--minify",
              "--log-level=warning", f"--outfile={out / 'engine.js'}"], ui)
        write_boot(root, out / "boot", Path(tmp))
    (out / "version.json").write_text(json.dumps({"commit": commit, "generic": generic}), encoding="utf-8")
    return {"archive_bytes": (out / ARCHIVE).stat().st_size, "files": files}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Build the published site to ui/dist/.")
    ap.add_argument("--generic", action="store_true", default=bool(os.environ.get("VERCEL") or os.environ.get("GENERIC_NAMES")),
                    help="swap every real name for a lookalike (always on when Vercel builds)")
    args = ap.parse_args()
    info = build(generic=args.generic)
    print(f"ui/dist/: {ARCHIVE} {info['archive_bytes'] / 1e6:.1f} MB, {len(info['files'])} files, "
          f"{'generic' if args.generic else 'real'} names")
