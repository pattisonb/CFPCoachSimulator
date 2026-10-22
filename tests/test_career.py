"""Coach Career: a season started as a career carries the career layer; a plain season, a
"remaining" season and older saves stay exactly as they were. (Run as a file: multiprocessing
on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import career
import season

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=3, career=True)
    assert career.is_career(st) and st["career"]["year"] == 2026
    # a career with its recruiting class stays small enough to keep in the browser every week
    import json as _json
    size = len(_json.dumps(st["recruiting"], separators=(",", ":")))
    assert size < 4_000_000, f"the recruiting class is {size / 1e6:.1f} MB"
    assert len(career.export_save(st)) < 1_500_000, "a new career's save is over 1.5 MB"
    assert st["career"]["settings"]["auto_recruit"] is False and st["career"]["saved_week"] == 0

    plain = season.new_season("ohio-state", "full", seed=3)
    assert not career.is_career(plain) and "recruiting" not in plain
    season.advance(plain)
    assert plain["current_week"] == 1                      # older-style seasons play on unchanged

    try:
        season.new_season("ohio-state", "remaining", career=True)
        raise AssertionError("a career started from today")
    except ValueError:
        pass
    # saves: saving stamps the career with its week; a download round-trips with its box scores
    season.advance(st)
    season.save_season(st)
    assert st["career"]["saved_week"] == 1
    some_box = next(p.name for p in season.box_dir(st).glob("*.json"))
    blob = career.export_save(st)
    import shutil
    shutil.rmtree(season.SEASONS_DIR / st["id"])
    (season.SEASONS_DIR / f"{st['id']}.json").unlink()
    back = career.import_save(blob)
    assert back["id"] == st["id"] and back["career"] == st["career"] and back["current_week"] == 1
    assert (season.box_dir(back) / some_box).exists(), "box scores did not come back"
    # the browser's weekly copy leaves out other games' box scores (your games ride in the state)
    light = career.export_save(st, boxes=False)
    assert len(light) < len(blob) and career.read_save(light)[1] == {}
    assert career.read_save(light)[0]["my_boxes"] == st["my_boxes"]
    try:
        career.import_save(career.export_save(plain))
        raise AssertionError("a plain season was imported as a career")
    except ValueError:
        pass
    # the newer copy wins, whichever side it is on
    older = dict(st, career=dict(st["career"], saved_week=2))
    newer = dict(st, career=dict(st["career"], saved_week=5))
    assert career.newer(older, newer) is newer and career.newer(newer, older) is newer
    # a restore never replaces a newer server copy, and fills in a forgotten one
    stale = career.export_save(older)
    kept = career.restore(stale, current=newer)
    assert kept is newer, "an older upload replaced the newer server copy"
    (season.SEASONS_DIR / f"{st['id']}.json").unlink()
    restored = career.restore(career.export_save(newer), current=None)
    assert restored["career"]["saved_week"] == 5 and season.load_season(st["id"])["career"]["saved_week"] == 5
    # uploads are checked before anything is written: a gzip bomb, a wrong shape, box names
    # that leave the folder, an id that belongs to a season that is not a career
    import gzip as _gz
    bomb = _gz.compress(b"{" + b" " * (300 * 1024 * 1024) + b"}")
    for bad in (bomb, _gz.compress(_json.dumps({"state": {"id": "abc123", "career": {"x": 1}}}).encode())):
        try:
            career.read_save(bad)
            raise AssertionError("a bad upload was accepted")
        except ValueError:
            pass
    sneaky = _gz.compress(_json.dumps({"state": newer, "boxes": {"D:evil.json": "{}", "ok-1.json": "{}", "a..json": "{}"}}).encode())
    assert set(career.read_save(sneaky)[1]) == {"ok-1.json"}
    plain_same_id = dict(plain, id=st["id"])
    try:
        career.restore(career.export_save(newer), current=plain_same_id)
        raise AssertionError("a career replaced a plain season with the same id")
    except ValueError:
        pass
    print("career ok")
