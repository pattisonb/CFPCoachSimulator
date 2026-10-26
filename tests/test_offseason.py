"""Coach Career's offseason (offseason.py, league.py): departures, the signed classes arriving,
the transfer portal, development, staff, and the next season on the career's own league. A
finished season is faked (scores and signed classes) so the test runs in seconds; the long-run
check plays real ones (tools/long_run.py). (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
import collections
import random

from coach_career import league
from coach_career import offseason
from sim import season


def finished(st: dict) -> None:
    """Every game played (the better team usually wins), every school's class signed, season over."""
    rng = random.Random(1)
    teams = season.load_teams()
    for g in st["games"].values():
        h, a = teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]
        hs = rng.randint(10, 45)
        win = rng.random() < 1 / (1 + 10 ** ((a - h) / 12))
        g.update(played=True, home_score=hs if win else max(0, hs - rng.randint(1, 20)), away_score=hs - rng.randint(1, 20) if win else hs)
        if g["home_score"] == g["away_score"]:
            g["home_score"] += 3
    rc = st["recruiting"]
    schools = [s for s, t in teams.items() if not t["fictional"]]
    pids = sorted(rc["prospects"], key=lambda p: rc["prospects"][p]["rank"])
    for i, pid in enumerate(pids[:len(schools) * 21]):
        rc["status"][pid]["signed"] = schools[i % len(schools)]
    st.update(done=True, current_week=season.FINAL_WEEK, champion="ohio-state")


if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(st)
    before = {p["slug"]: p.get("class") for t in season.load_teams().values() for p in t["offense"] + t["defense"]}
    off = offseason.start(st)
    lg = st["league"]
    kinds = collections.Counter(d["kind"] for d in off["departures"])
    teams = len(lg["teams"])
    # departures: seniors graduate, the draft takes its FBS share, some declare early, about 15%
    # of the rest enter the portal, a few quit
    assert 15 * teams <= kinds["graduated"] + kinds["draft"] <= 24 * teams, kinds
    assert kinds["draft"] == round(offseason.DRAFT_PICKS * offseason.DRAFT_FROM_FBS)
    # the draft by position matches the real drafts (data/draft_targets.json, 2021-2025 averages):
    # each bucket's picks a draft within 5 or half the target; round one (32 picks, so one draft is
    # noisy) within 4 a bucket and 15 over all of them; tools/calibrate_draft.py averages nine drafts
    import json
    targets = json.loads((_Path(__file__).resolve().parents[1] / "data" / "draft_targets.json").read_text(encoding="utf-8"))
    bucket = {"QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OT", "RT": "OT", "LG": "IOL", "RG": "IOL", "C": "IOL",
              "LEDG": "EDGE", "REDG": "EDGE", "DT": "DL", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "CB": "CB", "FS": "S", "SS": "S",
              "K": "K", "P": "P"}
    drafted = [d for d in off["departures"] if d["kind"] == "draft"]
    allp = collections.Counter(bucket[d["pos"]] for d in drafted)
    r1 = collections.Counter(bucket[d["pos"]] for d in drafted if d["pick"] <= 32)
    k = offseason.DRAFT_PICKS * offseason.DRAFT_FROM_FBS / targets["picks_a_draft"]
    for b, want in targets["all"].items():
        assert abs(allp[b] - want * k) <= max(5, 0.5 * want * k), (b, allp[b], want * k)
    for b, want in targets["round1"].items():
        assert abs(r1[b] - want) <= 4, (b, r1[b], want)
    assert sum(abs(r1[b] - want) for b, want in targets["round1"].items()) <= 15, dict(r1)
    early = sum(1 for d in off["departures"] if d.get("early"))
    assert 40 <= early <= 140, early
    # underclassmen three years out of high school declare: juniors, redshirt juniors and redshirt sophomores
    early_cls = collections.Counter(d["cls"] for d in off["departures"] if d.get("early"))
    assert set(early_cls) <= offseason.UNDERCLASS_ELIGIBLE, early_cls
    assert early_cls["JR"] > 0 and early_cls["SORS"] > 0, early_cls
    assert any(d["kind"] == "draft" and d["cls"] == "SORS" for d in off["departures"]), "no redshirt sophomore drafted"
    returning = sum(len(t["roster"]) for t in lg["teams"].values()) + len(off["portal"]["players"])
    share = len(off["portal"]["players"]) / returning
    assert 0.06 <= share <= 0.22, share
    assert kinds["quit"] < 0.03 * returning
    # the classes arrived (21 a school here) and nobody is still a senior
    assert sum(off["signed"].values()) == 21 * teams
    for t in lg["teams"].values():                     # every returning player moved up a class or took his redshirt
        for p in t["roster"]:
            if p["id"] in before and not p.get("signed"):
                was = before[p["id"]]
                assert p["cls"] in (offseason.NEXT_CLASS.get(was), was + "RS") or (was, p["cls"]) == ("SR", "SRRS"), (was, p["cls"])
    mine = offseason.view(st)
    assert mine["departures"]["mine"] and all(d["team"] == "ohio-state" for d in mine["departures"]["mine"])
    # the portal as recruiting: four weeks, no stars, your offer with a pitch and a campus visit, entrants decide each week
    from coach_career import prospects, recruiting
    offseason.advance(st)
    assert off["stage"] == "portal_w1" and st["recruiting"].get("portal") and st["recruiting"]["week"] == 1
    assert st.get("recruiting_last") and not st["recruiting_last"].get("portal")      # the signed class is kept
    rc = st["recruiting"]
    entrants = len(rc["prospects"])
    assert entrants == len(off["portal"]["players"])
    assert all(p["stars"] is None and p.get("portal_rank") and p.get("from_name") and "line" in p and p.get("nil_ask") is not None
               for p in rc["prospects"].values())
    view = prospects.recruiting_view(st)
    assert view["portal"]["week"] == 1 and view["open_spots"] >= 0 and 0 < len(view["board"]) <= offseason.PORTAL_BOARD   # your staff's first look
    pick = next(q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]) if rc["prospects"][q]["from"] != "ohio-state")
    rc["board"].append(pick)
    recruiting.act(st, "ohio-state", pick, "offer", pitch=rc["prospects"][pick]["priorities"][0], nil=recruiting.ask_from(st, "ohio-state", pick))
    recruiting.act(st, "ohio-state", pick, "official_visit")        # a campus visit: this week, no home game needed
    assert (rc["visits"][pick].get("ohio-state") or {}).get("done")
    for w in (2, 3, 4):
        offseason.advance(st)
        assert off["stage"] == f"portal_w{w}" and rc["week"] == w, (off["stage"], rc["week"])
    signed_w3 = sum(1 for s_ in rc["status"].values() if s_["signed"])
    assert 0 < signed_w3 < entrants, signed_w3
    before_dev = {p["id"]: p["o"] for t in lg["teams"].values() for p in t["roster"]}
    offseason.advance(st)
    assert off["stage"] == "development"
    # development is not cookie-cutter: teams have good and bad years (a team-year shock on top of
    # the program and the coaches), players boom and bust
    import statistics
    team_gain = [statistics.mean(p["o"] - before_dev[p["id"]] for p in t["roster"] if p["id"] in before_dev) for t in lg["teams"].values()]
    assert statistics.pstdev(team_gain) >= 0.4, (statistics.mean(team_gain), statistics.pstdev(team_gain))
    eras = [t.get("era") for t in lg["teams"].values()]
    assert all(e is not None for e in eras) and statistics.pstdev(eras) >= 0.1, statistics.pstdev([e or 0 for e in eras])
    gains = [p["o"] - before_dev[p["id"]] for t in lg["teams"].values() for p in t["roster"] if p["id"] in before_dev and p["cls"] in ("SO", "SORS")]
    assert statistics.pstdev(gains) >= 2.5, statistics.pstdev(gains)
    placed = sum(1 for e in off["portal"]["players"].values() if e["signed"])
    assert 0.55 <= placed / entrants <= 0.95, placed / entrants
    # the best transfers mostly land at the strongest programs (real: about 70% of the top 50 at top-25 programs)
    model = recruiting.model()["teams"]
    top25 = set(sorted(model, key=lambda s_: -model[s_]["strength"]["baseline"])[:25])
    best = sorted(off["portal"]["players"].values(), key=lambda e: -e["player"]["o"])[:50]
    top_share = sum(1 for e in best if e["signed"] in top25) / len(best)
    assert top_share >= 0.45, top_share            # 0.40-0.46 before the portal change, 0.50-0.68 after; one offseason is noisy
    g5 = [s_ for s_ in lg["teams"] if not offseason.p4_school(s_)]
    per_g5 = sum(1 for e in off["portal"]["players"].values() if e["signed"] in g5) / len(g5)
    assert 1.0 <= per_g5 <= 5.5, per_g5
    assert any(p.get("walk_on") and p.get("preferred") for t in lg["teams"].values() for p in t["roster"]), "no preferred walk-ons"
    sizes = [len(t["roster"]) for t in lg["teams"].values()]
    assert min(sizes) >= 70 and max(sizes) <= offseason.ROSTER_LIMIT, (min(sizes), max(sizes))
    for t in lg["teams"].values():
        counts = offseason._group_counts(t["roster"])
        assert all(counts[g] >= f for g, f in offseason.FLOOR.items()), counts
    assert off["report"]["development"]["mean_gain_ea"] > 0
    # staff: an opening gets three candidates; your pick is hired
    offseason.advance(st)
    assert off["stage"] == "staff"
    staff = off["staff"]
    if not staff["leaving"]:
        sid = st["career"]["staff"][2]["id"]
        staff["leaving"].append(sid)
        staff["candidates"][sid] = [offseason._candidate(random.Random(i), st["career"]["staff"][2], set()) for i in range(3)]
    sid = staff["leaving"][0]
    offseason.hire(st, sid, 1)
    # the carousel: ADs judge their coaches, some are fired, retire or leave, every opening is filled;
    # you won it all, so you are safe, and a better program with an opening may want you
    car = off["carousel"]
    gone = [c for c in car["changes"] if c["role"] == "head_coach" and c["reason"] in ("fired", "retired", "left for the NFL")]
    assert 1 <= len(gone) <= 45, len(gone)
    assert all((t["coaches"].get("head_coach") or {}).get("name") for t in lg["teams"].values())
    assert car["you"]["security"] >= 70 and not car["you"]["fired"], car["you"]
    car["offers"] = car["offers"] or ["alabama"]
    target = car["offers"][0]
    offseason.choose_job(st, target)
    offseason.advance(st)
    assert off["stage"] == "ready"
    hired = next(s for s in st["career"]["staff"] if s["id"] == sid)
    assert hired["name"] == staff["candidates"][sid][1]["name"]
    # the next season: same career, its own league, a new class of seniors, the 2026 schedule's
    # games with home and away swapped
    old_game = next(g for g in st["games"].values() if g["kind"] == "regular" and not g["neutral"] and g["home"] == "ohio-state")
    new = offseason.next_season(st)
    assert new["id"] == st["id"] and new["year"] == 2027 and new["recruiting"]["year"] == 2028
    assert new["team"] == target and new["career"]["history"][-1]["moved_to"] == target, "taking the job did not move you"
    assert new["career"]["history"][0]["year"] == 2026 and new["career"]["history"][0]["won_title"]
    assert league.path(new["id"], 2027).exists() and season._league_path == league.path(new["id"], 2027)
    back = new["games"].get(old_game["event_id"])
    assert back and back["home"] == old_game["away"] and back["away"] == "ohio-state", back
    assert new["polls"]["0"]["ap"] and not new["done"] and new["current_week"] == 0
    roster = season.load_teams()["ohio-state"]
    names = {p["name"] for p in roster["offense"] + roster["defense"]}
    assert len(names) >= 70 and any(p.get("class") == "FR" for p in roster["offense"] + roster["defense"])
    season.advance_to(new, 1)
    assert all(g["played"] for g in new["games"].values() if g["week"] == 1)
    # a saved career comes back on its league; a missing league file is rebuilt from the save
    season.save_season(new)
    season.use_league(None)
    league.path(new["id"], 2027).unlink()
    back = season.load_season(new["id"])
    season.activate(back)
    assert league.path(new["id"], 2027).exists() and season.load_teams()["ohio-state"]["name"] == roster["name"]
    (season.SEASONS_DIR / f"{new['id']}.json").unlink()
    league.forget(new["id"])
    season.use_league(None)
    print(f"offseason ok: {dict(kinds)}, early entrants {early} {dict(early_cls)}, portal {share:.0%}, rosters {min(sizes)}-{max(sizes)}")
