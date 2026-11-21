"""Roll a face, once, for every real player and coach with no photo-made preset, and save it in his team's file
(cfb_sim_data/faces/<team>.json, under "rolled"). Run again and the same faces come out: each is seeded by his id.

    python3 tools/faces/roll.py            # fill in whoever has no face
    python3 tools/faces/roll.py --redo     # roll them all again

A roll is a guess, not a likeness. The photo-made faces teach it: a skin tone is drawn with odds tilted by first name,
last name and position group (how often each went with each tone among the players we have photos for), and the rest of
the face (hair, its color, beard, shape...) is copied from a photo-made player of that tone at that position group, so
the parts always go together. Linemen get a wide shape and skill players a narrower one, as the page does."""
from __future__ import annotations

import json
import math
import random
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FACES, TEAMS = ROOT / "cfb_sim_data" / "faces", ROOT / "cfb_sim_data" / "teams"
TONES = ["porcelain", "light", "tan", "brown", "dark", "deep"]
SMOOTH = 0.6          # *tune* how much a name seen only once or twice is trusted (higher: less)
GROUPS = {"QB": "QB", "HB": "RB", "FB": "RB", "RB": "RB", "WR": "WR", "TE": "TE", "K": "KP", "P": "KP",
          "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL", "RT": "OL", "OL": "OL", "DT": "DL", "DL": "DL",
          "LEDG": "EDGE", "REDG": "EDGE", "EDGE": "EDGE", "DE": "EDGE", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "LB": "LB",
          "CB": "DB", "FS": "DB", "SS": "DB", "S": "DB", "DB": "DB"}


def _names(name: str) -> tuple[str, str]:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    t = [re.sub(r"[^a-z]", "", x) for x in re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s).split()]
    t = [x for x in t if x]
    return (t[0] if t else "", t[-1] if t else "")


def main() -> None:
    redo = "--redo" in sys.argv
    people, files = [], {}                       # (team, key, name, group, coach?)
    for path in sorted(TEAMS.glob("*.json")):
        t = json.loads(path.read_text(encoding="utf-8"))
        if t.get("fictional") or path.stem.startswith("fcs-"):
            continue
        fp = FACES / f"{path.stem}.json"
        f = json.loads(fp.read_text(encoding="utf-8")) if fp.is_file() else {}
        files[path.stem] = {"players": f.get("players") or {}, "coaches": f.get("coaches") or {}, "rolled": {} if redo else (f.get("rolled") or {})}
        for p in t["roster"]:
            people.append((path.stem, p["slug"], p["name"], GROUPS.get(p["position"], "LB"), False))
        for c in (t.get("coaches") or {}).values():
            if c and c.get("name"):
                people.append((path.stem, "coach:" + c["name"], c["name"], "COACH", True))

    # what the photo-made faces say: tone counts by first name, last name and group; donors by (group, tone)
    first, last, group, prior = defaultdict(Counter), defaultdict(Counter), defaultdict(Counter), Counter()
    donors: dict = defaultdict(list)
    for team, key, name, g, coach in people:
        face = files[team]["coaches"].get(name) if coach else files[team]["players"].get(key)
        if not face:
            continue
        tone = face["skinTone"]
        fn, ln = _names(name)
        first[fn][tone] += 1; last[ln][tone] += 1; group[g][tone] += 1; prior[tone] += 1
        donors[(g, tone)].append(face)
    total = sum(prior.values())

    def odds(name: str, g: str) -> list[float]:
        fn, ln = _names(name)
        out = []
        for tone in TONES:
            p = prior[tone] / total
            lp = math.log(p)
            for table in (first[fn], last[ln], group[g]):      # naive Bayes: each clue's likelihood ratio, smoothed
                n = sum(table.values())
                lp += math.log(((table[tone] + SMOOTH * p * len(TONES)) / (n + SMOOTH * len(TONES))) / p) if n else 0.0
            out.append(lp)
        m = max(out)
        return [math.exp(x - m) for x in out]

    made = 0
    for team, key, name, g, coach in people:
        f = files[team]
        if (name in f["coaches"]) if coach else (key in f["players"]):
            f["rolled"].pop(key, None)
            continue
        if key in f["rolled"]:
            continue
        rng = random.Random(f"face-roll-{key}")
        tone = rng.choices(TONES, weights=odds(name, g))[0]
        pool = donors.get((g, tone)) or [d for (gg, tt), ds in donors.items() if tt == tone for d in ds]
        f["rolled"][key] = dict(rng.choice(pool))
        made += 1

    for team, f in files.items():
        out = {"players": dict(sorted(f["players"].items())), "coaches": f["coaches"], "rolled": dict(sorted(f["rolled"].items()))}
        text = "{\n" + ",\n".join(
            f" {json.dumps(k)}: {{\n" + ",\n".join(f"  {json.dumps(n, ensure_ascii=False)}: {json.dumps(v)}" for n, v in d.items())
            + ("\n" if d else "") + " }" for k, d in out.items()) + "\n}\n"
        json.loads(text)
        (FACES / f"{team}.json").write_text(text, encoding="utf-8")
    print(f"rolled {made} faces; {total} photo-made faces taught the odds")


if __name__ == "__main__":
    main()
