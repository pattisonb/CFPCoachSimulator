"""Put faces described from photos into the preset files.

    python3 tools/faces/apply_lines.py lines.txt

Each line of the file:   id | shape skin hairColor hair fade beard mouth eye nose ears | tags | source
- id: a player's slug, or `coach:<Name>` for a coach (as in tools/faces/still_generated.md)
- the ten fields are the ones tools/faces/pipeline/BRIEF.md explains (hair or beard `-` for none)
- tags (optional): features the parts cannot draw, space-separated (gray_hair glasses ...), kept in missing_features.json
- source (optional): where the photo was seen
Lines that do not parse, or name nobody on a real roster, are reported and skipped. A face written here replaces a
rolled one; run tools/faces/roll.py after to clear the replaced rolls."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FACES, TEAMS = ROOT / "cfb_sim_data" / "faces", ROOT / "cfb_sim_data" / "teams"
SKIN = "porcelain light tan brown dark deep".split()
COLOR = "black darkbrown brown blond red auburn".split()
HAIR = "00 01 02 03 04 05 06 07 08 09 10 11 12 14 17 19 20 23 24 25 26 27 -".split()
EYE = "brown dark hazel green blue gray".split()


def face(fields: list[str]) -> dict:
    sh, sk, hc, ha, fa, be, mo, ey, no, ea = fields
    ok = (sh in [f"0{i}" for i in range(8)] and sk in SKIN and hc in COLOR and ha in HAIR and fa in "01" and be in "01 02 03 04 -".split()
          and mo in "00 01 02 03".split() and ey in EYE and no in "00 01 02 03 04".split() and ea in "00 01 02 03".split())
    if not ok:
        raise ValueError("a field is not one of its options")
    return {"faceShape": "face_shape_" + sh, "skinTone": sk, "hairColor": hc, "eyeColor": ey, "ears": "ears_" + ea, "chin": None,
            "nose": "nose_" + no, "beard": None if be == "-" else "beard_" + be, "mouth": "mouth_" + mo, "brows": "brows_00",
            "hair": None if ha == "-" else "hair_" + ha, "hairFade": fa == "1" and ha != "-", "flip": []}


def main() -> None:
    where: dict[str, tuple[str, str, str]] = {}          # id -> (team, name, role)
    for path in sorted(TEAMS.glob("*.json")):
        t = json.loads(path.read_text(encoding="utf-8"))
        if t.get("fictional") or path.stem.startswith("fcs-"):
            continue
        for p in t["roster"]:
            where[p["slug"]] = (path.stem, p["name"], p["position"])
        for role, c in (t.get("coaches") or {}).items():
            if c and c.get("name"):
                where.setdefault("coach:" + c["name"], (path.stem, c["name"], role))
    files: dict[str, dict] = {}
    feats = json.loads((ROOT / "tools/faces/missing_features.json").read_text(encoding="utf-8"))
    done = 0
    for n, line in enumerate(Path(sys.argv[1]).read_text(encoding="utf-8").splitlines(), 1):
        parts = [x.strip() for x in line.strip().strip("`").split("|")]
        if len(parts) < 2 or not parts[0] or parts[0].startswith("#"):
            continue
        key = parts[0]
        if key not in where:
            print(f"line {n}: nobody with the id {key!r}")
            continue
        try:
            f = face(parts[1].split())
        except ValueError as e:
            print(f"line {n} ({key}): {e}")
            continue
        team, name, role = where[key]
        coach = key.startswith("coach:")
        for slug in ([p.stem for p in FACES.glob("*.json")] if coach else [team]):     # a coach may hold two jobs' slots
            d = files.setdefault(slug, json.loads((FACES / f"{slug}.json").read_text(encoding="utf-8")))
            if coach and not any(c and c.get("name") == name for c in (json.loads((TEAMS / f"{slug}.json").read_text(encoding="utf-8")).get("coaches") or {}).values()):
                continue
            (d["coaches"] if coach else d["players"])[name if coach else key] = f
            d.get("rolled", {}).pop(key, None)
        tags = sorted(set(parts[2].lower().split())) if len(parts) > 2 and parts[2] else []
        if tags:
            feats["people"] = [x for x in feats["people"] if not (x["name"] == name and x["team"] == team)]
            feats["people"].append({"team": team, "id": None if coach else key, "name": name, "role": role, "coach": coach, "tags": tags})
        done += 1
    for slug, d in files.items():
        d["players"] = dict(sorted(d["players"].items()))
        text = "{\n" + ",\n".join(f" {json.dumps(k)}: {{\n" + ",\n".join(f"  {json.dumps(a, ensure_ascii=False)}: {json.dumps(b)}" for a, b in v.items())
                                  + ("\n" if v else "") + " }" for k, v in d.items()) + "\n}\n"
        json.loads(text)
        (FACES / f"{slug}.json").write_text(text, encoding="utf-8")
    counts: dict = {}
    for x in feats["people"]:
        for t in x["tags"]:
            c = counts.setdefault(t, {"people": 0, "coaches": 0}); c["people"] += 1; c["coaches"] += bool(x["coach"])
    feats["counts"] = dict(sorted(counts.items(), key=lambda kv: -kv[1]["people"]))
    feats["people"].sort(key=lambda p: (p["team"], not p["coach"], p["name"]))
    (ROOT / "tools/faces/missing_features.json").write_text(
        '{\n "about": ' + json.dumps(feats["about"]) + ',\n "counts": {\n' + ",\n".join(f"  {json.dumps(k)}: {json.dumps(v)}" for k, v in feats["counts"].items())
        + '\n },\n "people": [\n' + ",\n".join("  " + json.dumps(x, ensure_ascii=False) for x in feats["people"]) + "\n ]\n}\n", encoding="utf-8")
    print(f"{done} faces written")


if __name__ == "__main__":
    main()
