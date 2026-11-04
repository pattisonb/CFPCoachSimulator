"""A career saved before personas and scouting points loads and plays (app/api.py): no `scout_points`, no
contact `calls`, no `traits_known`, no `cooled_why`, the week's recruiting hours at an old 55, and a prospect whose
read already holds two looks. Every recruiting and scouting view answers; his profile and his board row show who
decides (two looks tell it, logged or not); Points Left is a number; a Send works and spends points.
Saves go to a temporary folder. Run as a file."""
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import api   # noqa: E402
from coach_career import persona, recruiting   # noqa: E402
from sim import season   # noqa: E402


def G(sid, path):
    return api.call("GET", f"/api/season/{sid}/{path}")


def old_save() -> tuple[str, str, str]:
    """A week-two career, two prospects scouted to two looks, then the new keys taken out as an old save lacks them."""
    me = "smu"
    st = season.new_season(me, "full", seed=31, career=True)
    season.advance_to(st, 2)
    rc = st["recruiting"]
    rc["hours"][me] = 1000
    free = [q for q in recruiting.prospect_list(st) if not rc["prospects"][q].get("hidden") and q in recruiting.visible(st)
            and not (rc["reads"].get(q) or {}).get("looks") and not rc["status"][q]["committed"]]
    read, fresh = free[0], free[1]
    while recruiting.report_looks(rc["reads"].get(read)) < persona.DECIDER_LOOKS:
        rc.setdefault("scout_points", {})[me] = 999
        recruiting.act(st, me, read, "scout")
    recruiting.act(st, me, fresh, "call")                 # a contact, its scene left open
    rc["board"] = [read, fresh]
    # the old save: none of the new keys
    rc.pop("scout_points", None)
    rc.pop("traits_known", None)
    rc.pop("cooled_why", None)
    for by in rc["contacts"].values():
        for c in by.values():
            c.pop("calls", None)
    rc["log"] = [e for e in rc["log"] if e["kind"] != "learned"]
    rc["hours"][me] = 55
    for p in rc["prospects"].values():
        p.pop("persona", None)
    season.save_season(st)
    raw = json.loads((season.SEASONS_DIR / f"{st['id']}.json").read_text())
    assert "scout_points" not in raw["recruiting"] and "traits_known" not in raw["recruiting"]
    assert recruiting.report_looks(raw["recruiting"]["reads"][read]) >= persona.DECIDER_LOOKS
    return st["id"], read, fresh


def main():
    sid, read, fresh = old_save()
    api.call("GET", f"/api/season/{sid}")
    v = G(sid, "recruiting")
    assert isinstance(v["points_left"], int) and isinstance(v["points_week"], int) and v["points_left"] == v["points_week"], (v["points_left"], v["points_week"])
    assert v["hours_left"] == 55, v["hours_left"]
    sv = G(sid, "scouting")
    assert isinstance(sv["points_left"], int) and sv["points_left"] > 0, sv["points_left"]
    G(sid, "scouting?scouted=1&sort=looks")
    G(sid, "scouting?on_board=1")
    G(sid, "recruiting/report")
    G(sid, "prospects?limit=50")
    G(sid, "classes")
    G(sid, f"classes?school={api.loaded_state()['team']}")
    st = api.loaded_state()
    d = persona.of(st, read)
    want = persona.DECIDER_LABEL[d["decider"]]
    row = next(b for b in v["board"] if b["id"] == read)
    assert row["traits"]["decider"] == want, row["traits"]
    prof = G(sid, f"prospect/{read}")
    assert prof["points_left"] == v["points_left"]
    assert next(b for b in G(sid, "recruiting")["board"] if b["id"] == fresh)["traits"]["decider"] is None, "no looks: not known yet"
    for pid in (read, fresh):
        G(sid, f"prospect/{pid}")
    # a Send works and spends points
    target = next(r for r in sv["queue"] if r["can_send"] and r["pid"] not in (read, fresh))
    before = sv["points_left"]
    out = api.call("POST", f"/api/season/{sid}/recruit", {"pid": target["pid"], "action": "scout"})
    assert out["look"], out
    after = G(sid, "scouting")["points_left"]
    assert after == before - target["cost"], (before, after, target["cost"])
    # the open call finishes on an old contact (no `calls`): the opening and the pitch answer
    sc = st["recruiting"]["scenes"][st["team"]][fresh]
    st["recruiting"]["hours"][st["team"]] = 55
    pr = api.call("POST", f"/api/season/{sid}/recruit", {"pid": fresh, "action": "present", "scene": sc["id"], "topics": list(recruiting.PITCHES[:3])})
    if pr["scene"]["question"]:
        api.call("POST", f"/api/season/{sid}/recruit", {"pid": fresh, "action": "answer", "scene": sc["id"], "answer": "deflect"})
    r = api.call("POST", f"/api/season/{sid}/recruit", {"pid": fresh, "action": "pitch", "scene": sc["id"], "pitch": recruiting.PITCHES[0]})
    assert r["reaction"]["kind"] in ("hit", "polite", "quiet", "tired", "guarded"), r["reaction"]
    text = json.dumps([G(sid, "recruiting"), G(sid, "scouting"), G(sid, f"prospect/{read}")])
    assert "NaN" not in text and "undefined" not in text
    print("persona old save ok: every view answers, two looks show who decides, Points Left is a number, a Send spends points")


if __name__ == "__main__":
    season.SEASONS_DIR = Path(tempfile.mkdtemp(prefix="cfp-persona-oldsave-"))
    try:
        main()
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
