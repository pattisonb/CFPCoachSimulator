"""The published site carries no real names (tools/build_site.py --generic, tools/generic): a staged copy of the
game and the app's source with the names swapped holds none of the real schools that change, mascots, stadiums,
bowls, conferences, awards, players or coaches; every real team has a lookalike; the swap is the same every time;
and a career at a renamed school starts and plays a week on the swapped data. The repository itself is untouched.
`python3 tests/test_generic_names.py`"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools import build_site   # noqa: E402
from tools.generic import check, scrub, tables   # noqa: E402

PLAY = """
import json, sys
from app import api
s = api.call("POST", "/api/season", {"team": sys.argv[1], "seed": 11})
api.call("POST", f"/api/season/{s['id']}/advance", {"to": 1})
while api.running():
    api.step(None)
teams = api.call("GET", "/api/teams")
print(json.dumps({"season": s, "week": api.call("GET", f"/api/season/{s['id']}/week/1"), "teams": teams}, ensure_ascii=False))
"""


def initial(word):
    return next((ch.upper() for ch in word if ch.isalpha()), "A")


def main():
    before = (ROOT / "cfb_sim_data" / "teams" / "notre-dame.json").stat().st_mtime
    terms = scrub.terms(ROOT)
    assert len(terms["people"]) > 10000 and len(terms["phrases"]) > 500, {k: len(v) for k, v in terms.items()}

    # the tables: every lookalike differs from the real name, and no two schools share one
    maps = scrub.Maps(ROOT)
    for slug, t in maps.real_teams.items():
        new = maps.team[slug]
        assert new["mascot"] != t["mascot"], f"{slug} keeps its real mascot"
        assert new["short"] != t["short_name"] and new["slug"] != slug, f"{slug} keeps its real name"
        assert new["abbr"] != t["abbreviation"], f"{slug} keeps its real abbreviation"
        assert new["stadium"] != t["stadium"]["name"], f"{slug} keeps its real stadium"
    for field in ("short", "abbr", "slug"):
        values = [v[field] for v in maps.team.values()]
        assert len(set(values)) == len(values), f"two schools share a lookalike {field}"
    real_shorts = {t["short_name"] for t in maps.real_teams.values()} | {t["abbreviation"] for t in maps.real_teams.values()}
    assert not real_shorts & ({v["short"] for v in maps.team.values()} | {v["abbr"] for v in maps.team.values()}), "a lookalike is another school's real name"
    for real, new in maps.person.items():
        first_real, last_real, _ = scrub.Names._parts(real)
        assert new != real and initial(new.split()[0]) == initial(first_real), (real, new)
        assert not last_real or initial(new.split()[1]) == initial(last_real), (real, new)      # "Van Dyke" is a V
    assert scrub.Maps(ROOT).person == maps.person, "the drawn names changed between two runs"
    assert not set(tables.TEAMS) - set(maps.real_teams), "tables.TEAMS names a school the league does not have"

    with tempfile.TemporaryDirectory(prefix="cfp-generic-") as tmp:
        root = build_site.stage(Path(tmp), generic=True)
        found = check.leaks(root, terms, build_site.game_files(root))
        assert not found, "real names in the generic build: " + json.dumps({k: dict(list(v.items())[:12]) for k, v in found.items()}, ensure_ascii=False)
        assert not (root / "cfb_sim_data" / "teams" / "notre-dame.json").exists()
        team = json.loads((root / "cfb_sim_data" / "teams" / "north-dome.json").read_text(encoding="utf-8"))
        assert team["short_name"] == "North Dome" and team["abbreviation"] == "NDM", team["short_name"]
        real = json.loads((ROOT / "cfb_sim_data" / "teams" / "notre-dame.json").read_text(encoding="utf-8"))
        assert team["colors"]["primary"]["hex"] != real["colors"]["primary"]["hex"]          # a protected shade: moved a hair
        assert abs(int(team["colors"]["primary"]["hex"][1:3], 16) - int(real["colors"]["primary"]["hex"][1:3], 16)) <= tables.COLOR_NUDGE
        kept = json.loads((root / "cfb_sim_data" / "teams" / "iowa-city.json").read_text(encoding="utf-8"))
        assert kept["short_name"] == "Iowa City" and kept["state"] == "IA"
        scenes = (root / "coach_career" / "scenes.py").read_text(encoding="utf-8")
        assert '"TX": "Texas"' in scenes, "a state lost its name to a school's swap"
        assert kept["colors"] == json.loads((ROOT / "cfb_sim_data" / "teams" / "iowa.json").read_text(encoding="utf-8"))["colors"]
        assert len(team["roster"]) == len(real["roster"])
        assert [p["overall"] for p in team["roster"]] == [p["overall"] for p in real["roster"]]   # only the names change

        # the swapped game plays: a career at a renamed school, one week
        r = subprocess.run([sys.executable, "-c", PLAY, "north-dome"], cwd=root, capture_output=True, text=True, encoding="utf-8",
                           env={**os.environ, "CFP_SEASONS_DIR": str(Path(tmp) / "seasons"), "SIM_WORKERS": "1", "PYTHONPATH": str(root)})
        assert r.returncode == 0, r.stderr[-2000:]
        out = json.loads(r.stdout.strip().splitlines()[-1])
        assert out["season"]["team_name"] == "North Dome", out["season"]
        said = Path(tmp) / "said"
        said.mkdir()
        (said / "said.py").write_text(r.stdout, encoding="utf-8")
        found = check.leaks(said, {**terms, "people": set()}, ["said.py"])     # people: a drawn recruit may share a common real name
        assert not found, "real names in what the game says: " + json.dumps({k: dict(list(v.items())[:12]) for k, v in found.items()}, ensure_ascii=False)

    assert (ROOT / "cfb_sim_data" / "teams" / "notre-dame.json").stat().st_mtime == before, "the repository's data was touched"
    print("test_generic_names: ok")


if __name__ == "__main__":
    main()
