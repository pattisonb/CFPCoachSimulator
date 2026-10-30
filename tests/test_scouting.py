"""Coach Career scouting (recruiting.py): your staff, their areas, and reads that narrow with
looks but can be wrong. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
import random
import statistics

from coach_career import prospects
from coach_career import recruiting
from sim import season


def coverage(st: dict, rating: int, pids: list[str]) -> tuple[float, float, list[tuple[float, bool]]]:
    """Four looks at each prospect by one evaluator: the share of ranges holding the true grade,
    the mean range width (grade points) and each (width, held) pair."""
    st["recruiting"]["reads"] = {}
    rng = random.Random(f"cov-{rating}")
    for pid in pids:
        for _ in range(4):
            recruiting.look(st, pid, rating, rng)
    rows = []
    for pid in pids:
        p = st["recruiting"]["prospects"][pid]
        for g in recruiting.GROUPS:
            lo, hi = recruiting.read_interval(st, pid, g)
            lo_l, hi_l = recruiting.grade_range(st, pid, g)
            truth = recruiting.WORDS.index(recruiting.word(p["truth"][g]))
            held = recruiting.WORDS.index(hi_l) <= truth <= recruiting.WORDS.index(lo_l)
            rows.append((hi - lo, held))
    return sum(h for _, h in rows) / len(rows), statistics.mean(w for w, _ in rows), rows


if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=7, career=True)
    rc = st["recruiting"]
    staff = st["career"]["staff"]
    assert [s["role"] for s in staff] == ["OC", "DC", "Recruiter", "Recruiter", "Recruiter"]
    assert all(s["area"] in recruiting.AREAS for s in staff) and len({s["area"] for s in staff}) == 5
    assert all(40 <= s["evaluation"] <= 99 for s in staff)
    # reads: an average evaluator holds the truth about 80%, an elite one about 90%, a weak one is
    # wider yet misses more, sometimes tight and wrong
    pids = list(rc["prospects"])[:500]
    avg, avg_w, avg_rows = coverage(st, 60, pids)
    elite, _, _ = coverage(st, 95, pids)
    weak, weak_w, weak_rows = coverage(st, 40, pids)
    assert 0.72 <= avg <= 0.88, avg
    assert 0.85 <= elite <= 0.95, elite
    assert weak < avg and weak_w > avg_w, (weak, avg, weak_w, avg_w)
    median_avg = statistics.median(w for w, _ in avg_rows)
    assert any(w < median_avg and not held for w, held in weak_rows), "a weak evaluator is never tight and wrong"
    # looks never reset when an area is reassigned; a week of scouting adds a look in every staffed area
    rc["reads"] = {}
    tx = next(pid for pid, p in rc["prospects"].items() if p["hometown"]["state"] == "TX")
    recruiter = next(s for s in staff if s["role"] == "Recruiter")
    recruiting.assign(st, recruiter["id"], "Texas") if all(s["area"] != "Texas" for s in staff) else None
    texan = next(s for s in staff if s["area"] == "Texas")
    recruiting.scout_week(st)
    looks = rc["reads"][tx]["looks"]
    assert looks == 1, looks
    recruiting.assign(st, texan["id"], "Florida")
    assert rc["reads"][tx]["looks"] == 1 and texan["area"] == "Florida"
    try:
        recruiting.assign(st, texan["id"], "Atlantis"); raise AssertionError("an unknown area was assigned")
    except recruiting.RecruitingError as e:
        assert e.code == 400
    # a hidden prospect is absent from the public list until your staff look at him
    hidden = [pid for pid, p in rc["prospects"].items() if p.get("hidden")]
    share = len(hidden) / sum(1 for p in rc["prospects"].values() if p["stars"] == 2 or (p["stars"] == 3 and p["composite"] < 0.82))
    assert 0.10 < share < 0.20, share
    h = next(pid for pid in hidden if pid not in rc["reads"])
    assert h not in recruiting.prospect_list(st)
    recruiting.look(st, h, 60, random.Random(1))
    assert h in recruiting.prospect_list(st)
    # Prospect Profiles: the top 300 get an evaluation and a public comp (only to a real starter
    # at his position, only when close); "our comp" once every group has three looks
    by_rank = {p["rank"]: pid for pid, p in rc["prospects"].items()}
    top = prospects.profile(st, by_rank[1], "ohio-state")
    assert top["evaluation"] and top["public_comp"], top["public_comp"]
    pool = {(c["name"], c["position"]) for c in prospects.starter_pool()}
    assert (top["public_comp"]["name"], top["public_comp"]["position"]) in pool
    assert top["public_comp"]["position"] == rc["prospects"][by_rank[1]]["ea_position"]
    truth = rc["prospects"][by_rank[1]]["truth"]
    best = max(prospects.EVAL_GROUPS, key=lambda g: truth[g])
    assert prospects.GROUP_NAMES[best] in " ".join(top["evaluation"]["strengths"]), (best, top["evaluation"])
    assert top["public"]["national_rank"] == 1 and top["public"]["position_rank"] == 1
    mid = prospects.profile(st, by_rank[900], "ohio-state")
    assert mid["evaluation"] is None and mid["public_comp"] is None
    two = next(pid for pid, p in rc["prospects"].items() if p["stars"] == 2 and not p.get("hidden")
               and prospects.comp(prospects.ceiling(st, p), p["ea_position"], prospects.starter_pool()) is None)
    assert prospects.profile(st, two, "ohio-state")["public_comp"] is None
    fresh = next(by_rank[r] for r in range(2, 60)       # a top prospect a starter compares to (an elite ceiling can have none)
                 if prospects.comp(prospects.ceiling(st, rc["prospects"][by_rank[r]]), rc["prospects"][by_rank[r]]["ea_position"],
                                   prospects.starter_pool()) is not None)
    rc["reads"].pop(fresh, None)
    assert prospects.profile(st, fresh, "ohio-state")["our_comp"] is None
    assert prospects.profile(st, fresh, "ohio-state")["our_grades"] is None
    for _ in range(3):
        recruiting.look(st, fresh, 90, random.Random(_))
    ours = prospects.profile(st, fresh, "ohio-state")
    assert ours["our_comp"] is not None and set(ours["our_grades"]) == set(recruiting.GROUPS)
    assert "truth" not in ours["public"]
    # hovering a grade: what prospects graded like that look like in ratings
    det = ours["grade_details"]
    assert set(det) == set(recruiting.GROUPS) and "Top Speed" in det["athleticism"]["ratings"], det["athleticism"]
    # one scale: the game's (player cards'), never EA's: no EA attribute names, comps by the card overall
    assert not any(k in det[g]["ratings"] for g in det for k in ("speed", "acceleration", "change of direction"))
    assert "Projected overall" in det["potential"]["ratings"]
    # each number placed among today's players at his position (from the read's middle value)
    lg = det["athleticism"]["league"]["Top Speed"]
    assert 1 <= lg["rank"] <= lg["of"] and 1 <= lg["starter_rank"] <= lg["starters"] + 1 and lg["of"] > lg["starters"] > 20
    pot = det["potential"]["league"]["Projected overall"]
    assert 1 <= pot["rank"] <= pot["of"]
    assert "overall_ea" not in (ours["our_comp"] or {}) and (ours["our_comp"] or {}).get("overall") is not None
    # one scale for grades too: a grade is the average of the card numbers behind it (the potential
    # grade his projected overall), and its word is cut on the game's scale, where 50 is the middle
    # Power 4 starter (Solid), 65 Strong and 80 Elite: attributes in the 80s are Elite, not Strong
    assert [recruiting.word(v) for v in (95, 90, 85, 80, 70, 65, 55, 50, 45, 40, 30)] == \
        ["All-American", "All-American", "Elite", "Elite", "Strong", "Strong", "Solid", "Solid", "Fair", "Fair", "Weak"]
    assert "Generational" not in recruiting.WORDS
    sample = list(rc["prospects"].values())[::40]
    for q in sample:
        cards = prospects.game_attributes(st, q)
        for g in ("athleticism", "size_strength", "technique", "football_iq"):
            keys = prospects.group_keys(q, g)
            assert keys, (q["ea_position"], g)
            assert abs(q["truth"][g] - sum(cards[k] for k in keys) / len(keys)) < 0.6, (q["ea_position"], g, q["truth"][g])
    eighties = [q for q in rc["prospects"].values() if q["truth"]["athleticism"] >= 80]
    assert eighties and all(recruiting.word(q["truth"]["athleticism"]) in ("All-American", "Elite") for q in eighties)
    lb = next(pid for pid, q in rc["prospects"].items() if q["ea_position"] == "MIKE" and not q.get("hidden"))
    for _ in range(3):
        recruiting.look(st, lb, 90, random.Random(_))
    assert prospects.profile(st, lb, "ohio-state")["grade_details"]["technique"]["ratings"], "a linebacker's technique showed no ratings"
    assert all(0 <= lo <= hi <= 99 for g in det.values() for lo, hi in g["ratings"].values())
    assert det["coachability"]["labels"]
    hid = next(pid for pid, p in rc["prospects"].items() if p.get("hidden") and pid not in rc["reads"])
    try:
        prospects.profile(st, hid, "ohio-state"); raise AssertionError("a hidden prospect's profile was shown")
    except recruiting.RecruitingError as e:
        assert e.code == 404
    # a career saved before grades moved to the game's scale is converted on load: true grades
    # recomputed, each read keeps how far off it was and how many looks it took
    assert rc["grades"] == "game"
    pid = fresh
    now = dict(rc["prospects"][pid]["truth"])
    off = {g: rc["reads"][pid]["g"][g][0] - now[g] for g in recruiting.GROUPS}
    looks = rc["reads"][pid]["looks"]
    for g in recruiting.GROUPS:                                         # as an old save held them
        rc["prospects"][pid]["truth"][g] = 70.0
        rc["reads"][pid]["g"][g][0] = 70.0 + off[g]
    del rc["grades"]
    season.save_season(st)
    old = season.load_season(st["id"])
    orc = old["recruiting"]
    assert orc["grades"] == "game" and orc["prospects"][pid]["truth"] == now, orc["prospects"][pid]["truth"]
    assert all(abs(orc["reads"][pid]["g"][g][0] - (now[g] + off[g])) < 0.01 for g in recruiting.GROUPS)
    assert orc["reads"][pid]["looks"] == looks
    (season.SEASONS_DIR / f"{st['id']}.json").unlink()
    # a career saved while recruits were kept in EA numbers converts on load: our ratings, overall
    # and projected overall, true grades on our scale, each read still as far off as it was
    from teamdata import game_scale
    from coach_career import recruits
    old = {"id": "old-save", "recruiting": {"attrs": sorted(recruits.generate_class(2027, 3)[0]["ratings_ea"]), "prospects": {}, "reads": {}}}
    for q in recruits.generate_class(2027, 3)[:5]:
        q["ratings_ea"] = [q["ratings_ea"][k] for k in old["recruiting"]["attrs"]]
        q["potential_ea"] = [q["potential_ea"][k] for k in old["recruiting"]["attrs"]]
        q["truth"] = {g: 70.0 for g in recruiting.GROUPS}
        q["coachability"] = q.get("coachability") or "Steady Grinder"
        old["recruiting"]["prospects"][q["id"]] = q
    first = next(iter(old["recruiting"]["prospects"]))
    old["recruiting"]["reads"][first] = {"looks": 2, "by": {"60": 2}, "g": {g: [73.0, 0.05] for g in recruiting.GROUPS}}
    assert game_scale.upgrade(old) and old["recruiting"]["scale"] == "ours"
    q = old["recruiting"]["prospects"][first]
    assert "ratings_ea" not in q and len(q["ratings"]) == len(game_scale.keys()) and 1 <= q["ovr"] <= q["pot_ovr"] <= 99
    assert all(abs(old["recruiting"]["reads"][first]["g"][g][0] - (q["truth"][g] + 3.0)) < 0.01 for g in recruiting.GROUPS)
    # ----- scouting stops once he is yours -----------------------------------------------------
    me = "ohio-state"
    st["current_week"] = 1
    st["recruiting"]["hours"][me] = 55
    for p_ in st["recruiting"]["prospects"].values():
        p_["hidden"] = False
    scouted, unscouted, open_ = by_rank[20], by_rank[21], by_rank[22]
    for _ in range(3):
        recruiting.act(st, me, scouted, "scout")
    assert prospects.profile(st, scouted, me)["public"]["trips"] == 3 and prospects.profile(st, scouted, me)["our_grades"] is not None
    recruiting._commit(st, scouted, me)
    try:
        recruiting.act(st, me, scouted, "scout")
        raise AssertionError("a scout was sent to your own commit")
    except recruiting.RecruitingError as e:
        assert "committed to you" in str(e), str(e)
    prof = prospects.profile(st, scouted, me)
    assert prof["can_scout"] is False and prof["our_grades"] is not None and prof["public"]["trips"] == 3, (prof["can_scout"], prof["public"]["trips"])
    assert "coachability" in prof["our_grades"]
    # an unscouted commit stays unscouted: his area scout spends no look on him
    rc["reads"].pop(unscouted, None)
    recruiting._commit(st, unscouted, me)
    home = rc["prospects"][unscouted]["hometown"]["state"]
    area = next(a for a, codes in recruiting.AREAS.items() if home in codes)
    staff[2]["area"] = area
    before = {pid: r["looks"] for pid, r in rc["reads"].items()}
    recruiting.scout_week(st)
    assert unscouted not in rc["reads"], "your area scout looked at your own commit"
    prof = prospects.profile(st, unscouted, me)
    assert prof["can_scout"] is False and prof["our_grades"] is None and prof["looks"] == 0
    neighbor = next(pid for pid, p_ in rc["prospects"].items() if p_["hometown"]["state"] == home and rc["status"][pid]["committed"] is None)
    assert rc["reads"][neighbor]["looks"] == before.get(neighbor, 0) + 1, "an uncommitted prospect in the area still gets his look"
    # an uncommitted prospect still gets his three looks from you, and no more
    assert prospects.profile(st, open_, me)["can_scout"] is True
    for _ in range(3):
        recruiting.act(st, me, open_, "scout")
    assert prospects.profile(st, open_, me)["public"]["trips"] == 3 and prospects.profile(st, open_, me)["can_scout"] is False
    try:
        recruiting.act(st, me, open_, "scout")
        raise AssertionError("a fourth look")
    except recruiting.RecruitingError as e:
        assert "3 times" in str(e), str(e)
    rows = {r["id"]: r for r in prospects.search(st, me)["rows"]} if isinstance(prospects.search(st, me), dict) else {}
    if rows:
        assert rows[scouted]["can_scout"] is False and rows[open_]["can_scout"] is False
    # a gem is your staff's read, never the truth: force a tight high read on a two-star and he reads as a gem
    two = next(pid for pid, q in rc["prospects"].items() if q["stars"] == 2 and not q.get("hidden"))
    rc["reads"][two] = {"looks": 3, "by": {"95": 3}, "g": {g: [88.0, 100.0] for g in recruiting.GROUPS}}
    assert prospects.find(st, two) == "gem" and prospects.row(st, two, "ohio-state")["find"] == "gem"
    rc["reads"][two]["looks"] = 1
    assert prospects.find(st, two) is None, "a find needs FIND_LOOKS looks"
    rc["reads"][two]["looks"] = 2
    assert prospects.find(st, two) is None and recruiting.FIND_LOOKS == recruiting.SCOUT_MAX == 3, "every scouting badge waits for a full set of three looks"
    rc["reads"][two]["looks"] = 3
    five = next(pid for pid, q in rc["prospects"].items() if q["stars"] == 5)
    rc["reads"][five] = {"looks": 3, "by": {"95": 3}, "g": {g: [40.0, 100.0] for g in recruiting.GROUPS}}
    assert prospects.find(st, five) == "bust"
    rc["reads"][five]["g"]["potential"] = [88.0, 100.0]
    assert prospects.find(st, five) is None, "a five-star reading Elite is just a five-star"
    # the find is judged when he signs with you
    rc["status"][two].update(signed="ohio-state", committed="ohio-state")
    held = next(r for r in prospects.class_detail(st, "ohio-state", "ohio-state") if r["id"] == two)["find_held"]
    assert held == (rc["prospects"][two]["truth"]["potential"] >= 80)
    # a bust call is judged the same way: force a tight low read on a four-star and sign him with you
    four = next(pid for pid, q in rc["prospects"].items() if q["stars"] == 4 and not q.get("hidden") and pid != two)
    rc["reads"][four] = {"looks": 3, "by": {"95": 3}, "g": {g: [40.0, 100.0] for g in recruiting.GROUPS}}
    assert prospects.find(st, four) == "bust"
    rc["status"][four].update(signed="ohio-state", committed="ohio-state")
    row4 = next(r for r in prospects.class_detail(st, "ohio-state", "ohio-state") if r["id"] == four)
    assert row4["find"] == "bust" and row4["find_held"] == (rc["prospects"][four]["truth"]["potential"] < 50)
    print(f"scouting ok: ranges hold the truth {weak:.0%} (40), {avg:.0%} (60), {elite:.0%} (95); "
          f"widths {weak_w:.1f} vs {avg_w:.1f}; hidden {share:.0%}")
