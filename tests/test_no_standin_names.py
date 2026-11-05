"""The FCS stand-ins are named only for their regions ("FCS Mid-Atlantic", slug fcs-mid-atlantic):
the made-up school names, slugs, towns, mascots, stadiums and conference they once had appear in
no tracked file of the repository, case-insensitively. The forbidden strings are kept rot13-encoded
here so this file does not hold them either.

A save from before the rename (its state, its box scores, a downloaded .ccsave) is rewritten when
it is read (sim/fcs_names.py): an old-style save built here loads with today's slugs and labels
everywhere, keeps playing, and exports and imports clean. (Run as a file: saves go to a temporary
folder.)"""
import codecs
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# rot13: the old slugs, school names, towns, mascots, stadiums, conference and abbreviations. One
# old mascot is also a real FBS team's and is left out (it is checked on the stand-ins' records).
_FORBIDDEN = [
    "pnyqre-fcevatf", "cbeg-eraavpx", "erq-cenvevr-fgngr", "nyqre-evqtr", "jraqg-ynxr", "gnyhf-crnx", "prqne-fbhaq",
    "xrfgery-onl", "pnyqre fcevatf", "cbeg eraavpx", "erq cenvevr", "nyqre evqtr", "jraqg ynxr", "gnyhf crnx",
    "prqne fbhaq", "xrfgery onl", "sbetref", "pbggbazbhguf", "znevaref", "cynvafzra", "servtugref", "bepnf",
    "frn jbyirf", "rvtug eviref", "sheanpr uvyy", "yvir bnx objy", "frnjnyy fgnqvhz", "jvaqoernx fgnqvhz", "ber qbpx",
    "fjvgpuonpx fgnqvhz", "qevsgjbbq svryq", "uneobeivrj svryq", "nefh", "cefh", "pfqh", "resp",
]
FORBIDDEN = [codecs.decode(s, "rot13") for s in _FORBIDDEN]
PATTERN = re.compile(r"\b(" + "|".join(re.escape(s) for s in FORBIDDEN) + r")\b", re.I)


def tracked_files() -> list[Path]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout
    return [ROOT / f for f in out.decode("utf-8").split("\0") if f]


def test_repository_clean() -> int:
    hits = {}
    n = 0
    for f in tracked_files():
        try:
            text = f.read_bytes().decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue                       # binary (fonts, icons, archives)
        n += 1
        if PATTERN.search(f.name):
            hits[str(f.relative_to(ROOT))] = ["(the file name)"]
        found = sorted({m.group(0) for m in PATTERN.finditer(text)})
        if found:
            hits.setdefault(str(f.relative_to(ROOT)), []).extend(found[:3])
    assert not hits, f"old stand-in names in the repository: {hits}"
    assert n > 300, n
    return n


def test_stand_ins_named_by_region() -> None:
    """The source teams and the engine's teams: each stand-in's slug, names and abbreviation are
    its region's, and it has no mascot and no town."""
    from sim import season
    src = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((ROOT / "cfb_sim_data" / "teams").glob("*.json"))]
    fict = [t for t in src if t["fictional"]]
    assert len(fict) == 8, len(fict)
    for t in fict:
        lab = f"FCS {t['region']}"
        assert t["slug"] == "fcs-" + t["region"].lower().replace(" ", "-"), t["slug"]
        assert t["school_name"] == t["short_name"] == lab and t["abbreviation"] == "FCS", t["slug"]
        assert not t.get("mascot") and not t.get("city"), t["slug"]
        assert all(p["team"] == lab and p["slug"].endswith(t["slug"]) for p in t["roster"]), t["slug"]
    teams = season.load_teams()
    for slug, t in teams.items():
        if t["fictional"]:
            assert t["name"] == t["school"] == season.fcs_label(slug) == season.team_display(slug, teams), (slug, t["name"])
            assert t["mascot"] == "" and t["abbreviation"] == "FCS" and not t.get("city"), slug


# ----- a save from before the rename ----------------------------------------------------------

def _old_style(text: str) -> str:
    """Today's save text as it read before the rename: each stand-in's slug and label back to its
    old slug and short name (as the old box scores, schedules and rosters had them)."""
    from sim import fcs_names
    back = {}
    for region, (slug, names, _mascot, _stadium) in fcs_names._OLD.items():
        back[fcs_names.new_slug(region)] = codecs.decode(slug, "rot13")
        back[fcs_names.label(region)] = codecs.decode(names[1], "rot13")
    pat = re.compile("|".join(re.escape(k) for k in sorted(back, key=len, reverse=True)))
    return pat.sub(lambda m: back[m.group(0)], text)


def test_old_save_migrates() -> None:
    from app import api
    from coach_career import career
    from sim import coaches
    from sim import fcs_names
    from sim import season
    tmp = Path(tempfile.mkdtemp(prefix="cfp-standin-"))
    season.SEASONS_DIR, coaches.COACHES_DIR = tmp / "seasons", tmp / "coaches"
    try:
        st = season.new_season("smu", "full", seed=11, career=True)
        season.advance_to(st, 2)        # SMU's FCS game is in the first two weeks
        season.save_season(st)
        fcs_games = [g for g in st["games"].values() if season.state_fictional(g["home"]) or season.state_fictional(g["away"])]
        played = [g for g in fcs_games if g["played"]]
        assert played, "no FCS game played in two weeks"
        # turn the save and every box score into the old style
        path = season.SEASONS_DIR / f"{st['id']}.json"
        path.write_text(_old_style(path.read_text(encoding="utf-8")), encoding="utf-8")
        boxes = list(season.box_dir(st).glob("*.json"))
        for b in boxes:
            b.write_text(_old_style(b.read_text(encoding="utf-8")), encoding="utf-8")
        old_text = path.read_text(encoding="utf-8")
        assert fcs_names.has_old(old_text), "the old-style save holds no old slug"
        assert any(fcs_names.has_old(b.read_text(encoding="utf-8")) for b in boxes)
        blob_old = gzip_save(old_text, {b.name: b.read_text(encoding="utf-8") for b in boxes})

        # loading it rewrites the save and its box scores, once
        loaded = season.load_season(st["id"])
        assert not fcs_names.has_old(json.dumps(loaded)), "the loaded save still holds old names"
        assert not fcs_names.has_old(path.read_text(encoding="utf-8")), "the save file was not rewritten"
        assert not any(fcs_names.has_old(b.read_text(encoding="utf-8")) for b in boxes), "a box score file was not rewritten"
        assert json.loads(json.dumps(loaded["games"])) == json.loads(json.dumps(st["games"])), "the schedule did not map back"
        assert loaded["season_stats"] == json.loads(json.dumps(st["season_stats"])), "the season stats did not map back"
        teams = season.load_teams()
        for g in played:
            box = season.load_box(loaded, g["event_id"])
            for side in ("home", "away"):
                slug = box[f"{side}_slug"]
                assert slug in teams, slug
                if teams[slug]["fictional"]:
                    assert box[side]["name"] == season.fcs_label(slug), box[side]["name"]
                    assert all(s["team_name"] == season.fcs_label(slug) for s in box["scoring_plays"] if s["team"] == side)
        # it keeps playing on today's teams
        season.advance_to(loaded, 3)
        assert loaded["current_week"] == 3

        # a downloaded career from before the rename imports clean
        state, files = career.read_save(blob_old)
        assert not fcs_names.has_old(json.dumps(state)) and not any(fcs_names.has_old(t) for t in files.values())
        out = career.export_save(loaded, boxes=True)
        assert not fcs_names.has_old(__import__("gzip").decompress(out).decode("utf-8"))
        # the API's box score reads only the label for the stand-in's side
        api._hold(loaded)
        box = api.call("GET", f"/api/season/{loaded['id']}/game/{played[0]['event_id']}")
        fslug = played[0]["home"] if season.state_fictional(played[0]["home"]) else played[0]["away"]
        side = "home" if box["home_slug"] == fslug else "away"
        assert box[side]["name"] == season.fcs_label(fslug), box[side]["name"]
        cards = {c["slug"]: c for c in api.call("GET", "/api/teams")["teams"]}
        assert cards[fslug]["name"] == season.fcs_label(fslug) and cards[fslug]["mascot"] == "", cards[fslug]
    finally:
        season.close_pool()
        shutil.rmtree(tmp, ignore_errors=True)


def gzip_save(state_text: str, boxes: dict) -> bytes:
    import gzip
    return gzip.compress(json.dumps({"state": json.loads(state_text), "boxes": boxes}).encode("utf-8"))


if __name__ == "__main__":
    n = test_repository_clean()
    test_stand_ins_named_by_region()
    test_old_save_migrates()
    print(f"no stand-in names ok: {n} tracked files clean, the stand-ins named by region, an old save migrated")
