"""Give a roster player a new name (and number), with an id made from the new name, everywhere the old id is written.

    python3 tools/faces/rename_player.py <old-id> "<New Name>" [<jersey>]

Run python3 -m teamdata.build_teams after, and re-record the golden sim file if a renamed player is in it."""
import glob
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GENERATED = ("engine_teams.json", "player_potential.json", "base_league.json", "base_meta.json")


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s)).strip("-")


def rename(old: str, name: str, jersey: str | None = None) -> str:
    teams = glob.glob(f"{ROOT}/cfb_sim_data/teams/*.json")
    taken, home = set(), None
    for f in teams:
        for p in json.load(open(f, encoding="utf-8")).get("roster", []):
            taken.add(p["slug"])
            if p["slug"] == old:
                home = f
    if not home:
        raise SystemExit(f"nobody has the id {old}")
    team = os.path.basename(home)[:-5]
    new = slugify(name)
    if new != old and new in taken:
        new = f"{new}-{team}"
    raw = open(home, encoding="utf-8").read()
    t = json.loads(raw)
    ascii_only = json.dumps(t, indent=1, ensure_ascii=True) == raw
    p = next(q for q in t["roster"] if q["slug"] == old)
    was = p["name"]
    p["name"], p["url"] = name, None
    if jersey:
        p["jersey"] = str(jersey).lstrip("#")
    open(home, "w", encoding="utf-8").write(json.dumps(t, indent=1, ensure_ascii=ascii_only))
    files = teams + glob.glob(f"{ROOT}/cfb_sim_data/faces/*.json") + [f for f in glob.glob(f"{ROOT}/data/*.json") if os.path.basename(f) not in GENERATED] \
        + [f"{ROOT}/tools/faces/missing_features.json", f"{ROOT}/tools/faces/name_corrections.json"]
    for f in files:
        s = open(f, encoding="utf-8").read()
        out = s.replace(f'"{old}"', f'"{new}"')
        if out != s:
            json.loads(out)
            open(f, "w", encoding="utf-8").write(out)
    print(f"{team}: {was} ({old}) -> {name} ({new})")
    return new


if __name__ == "__main__":
    rename(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
