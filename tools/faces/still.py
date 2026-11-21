"""Rewrite tools/faces/still_generated.md: the players (and coaches) still on a generated face, in groups."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REAL = {
        "jamel-howse": "on his school's real roster", "jeremiah-daoud": "on his school's real roster",
       
        "lance-williams": "on his school's real roster, no headshot found",
        "nate-branch": "on his school's real roster, no headshot found",
        "justin-wood": "on his school's real roster, no headshot found",
        "robert-williams": "on his school's real roster, no headshot found",
        "dereyon-jenkins-jr": "on his school's real roster, no headshot found",
       "jamaun-thompson": "on ESPN's roster, no headshot there", "nico-wiedmann": "on ESPN at Marshall, no headshot there",
        "wydeek-collier-johnson": "his school lists him as Wydeek Collier", "guy-fernandez-iii": "his school lists him as Tre Fernandez",
        "lagarion-wilson": "on the 2026 roster (#13, CB)", "taveon-robinson": "on the school roster with a placeholder photo",
        "tim-anthony": "on the school roster with a placeholder photo", "tyrese-cathey": "on ESPN (DL #91), no headshot",
        "balint-vorosmarty": "on the school roster with a photo", "joshua-tavui": "his school lists him as Josh Tavui (OL)",
        "marquez-wimberly": "on the school roster (#25) with a logo placeholder",
        "l-a-jessie-harrold": "school and ESPN list him (EDGE #94), no photo; previously Florida State",
        "quantaves-gaskins": "may be the player listed as Gumbo Gaskins (S #22); confirm before using"}
swapped = {x["slug"] for x in json.loads((ROOT / "tools/faces/roster_swaps.json").read_text(encoding="utf-8"))}
a, b, c, coaches = [], [], [], []
for path in sorted((ROOT / "cfb_sim_data/teams").glob("*.json")):
    t = json.loads(path.read_text(encoding="utf-8"))
    if t.get("fictional") or path.stem.startswith("fcs-"):
        continue
    f = json.loads((ROOT / "cfb_sim_data/faces" / path.name).read_text(encoding="utf-8"))
    for role, co in (t.get("coaches") or {}).items():
        if co and co.get("name") and co["name"] not in f["coaches"]:
            coaches.append(f"coach:{co['name']} | {co['name']} | {t['short_name']} | {role.replace('_', ' ')}")
    for q in t["roster"]:
        if q["slug"] in f["players"]:
            continue
        line = f"{q['slug']} | {q['name']} | {t['short_name']} | {q['position']} | #{q.get('jersey')} | {q.get('class')} | {q.get('height')} {q.get('weight_lbs')} lb"
        if q["slug"] in REAL:
            a.append(line + " | " + REAL[q["slug"]])
        elif q["slug"] in swapped:
            b.append(line)
        else:
            c.append(line + f" | OVR {q.get('overall')}")
s = "# People still on a generated face\n\nEvery line starts with the id to copy back exactly.\n"
if coaches:
    s += f"\n## Coaches ({len(coaches)})\n\nid | name | school | job\n\n" + "\n".join(sorted(set(coaches))) + "\n"
s += f"\n## A. Real players, photo not reachable ({len(a)})\n\nid | name | school | position | jersey | class | height weight | note\n\n" + "\n".join(a)
s += f"\n\n## B. Real players given a made-up player's spot, no photo found ({len(b)})\n\nid | name | school | position | jersey | class | height weight\n\n" + "\n".join(b)
s += (f"\n\n## C. Made-up names with no real player to take the spot ({len(c)})\n\nSend a real player's name and number for any of these.\n\n"
      "id | made-up name | school | position | jersey | class | height weight | overall\n\n" + "\n".join(c) + "\n")
(ROOT / "tools/faces/still_generated.md").write_text(s, encoding="utf-8")
print(f"coaches {len(set(coaches))}, A {len(a)}, B {len(b)}, C {len(c)}")
