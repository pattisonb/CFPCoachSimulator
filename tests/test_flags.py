"""Gem and bust risk flags (prospects.find, recruiting.flag_cuts): the cuts are relative to his star
tier, so across a class the flags are a few percent of the prospects looked at, nearly all of them
real; a flag found holds through a look that moves the read a little (FLAG_HOLD), so the Scouting
tab's Flags list does not flicker. Measured on two seeds with every prospect in a staffed area given
exactly FIND_LOOKS looks by his area scout: a complete report, the most a prospect gets once area
looks are capped (the look-units change), and the point where a flag can first show. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
import random

from coach_career import prospects
from coach_career import recruiting
from sim import season

SEEDS = (("smu", 62), ("ohio-state", 8))
BAND = (0.02, 0.05)                 # gems of the prospects looked at FIND_LOOKS times; bust risks of the four- and five-stars among them
PRECISION = 0.5                     # at least this share of the gems are truly top-decile for their star tier


def truth_cut(rc: dict, stars: int, q: float) -> float:
    vals = sorted(p["truth"]["potential"] for p in rc["prospects"].values() if p["stars"] == stars)
    return recruiting._percentile(vals, q)


def rates(st: dict) -> dict:
    rc = st["recruiting"]
    looked = [pid for pid, r in rc["reads"].items() if r["looks"] >= recruiting.FIND_LOOKS and rc["prospects"][pid]["stars"] is not None]
    finds = {pid: prospects.find(st, pid) for pid in looked}
    gems = [pid for pid, f in finds.items() if f == "gem"]
    busts = [pid for pid, f in finds.items() if f == "bust"]
    high = [pid for pid in looked if rc["prospects"][pid]["stars"] >= 4]
    p90 = {s: truth_cut(rc, s, 0.9) for s in (2, 3, 4, 5)}
    real = sum(1 for pid in gems if rc["prospects"][pid]["truth"]["potential"] >= p90[rc["prospects"][pid]["stars"]])
    return {"looked": len(looked), "gems": len(gems), "busts": len(busts), "high": len(high),
            "gem_rate": len(gems) / len(looked), "bust_rate": len(busts) / len(high), "precision": real / len(gems) if gems else 1.0,
            "high_star_gems": sum(1 for pid in gems if rc["prospects"][pid]["stars"] >= 4)}


def complete_reports(st: dict) -> None:
    """Every prospect in a staffed area gets exactly FIND_LOOKS full looks at the staff member's rating.
    Looks come in trip units (an area look by a staff id is half a look, capped at AREA_CAP), so the
    looks go in as trips (`by` "trip", SEND_LOOK each): three full looks, a complete report."""
    rc, me = st["recruiting"], st["team"]
    rng = random.Random(f"flags-{rc['seed']}")
    for member in st["career"]["staff"]:
        for code in recruiting.AREAS.get(member["area"], []):
            for pid, p in rc["prospects"].items():
                if p["hometown"]["state"] == code and not rc["status"][pid]["signed"] and rc["status"][pid]["committed"] != me:
                    for _ in range(recruiting.FIND_LOOKS):
                        recruiting.look(st, pid, member["evaluation"], rng, by="trip", week=1)


def check_flicker(st: dict) -> None:
    """A flag found holds through a look that moves the read a little, and through one that moves a grade
    word; it releases once the read moves FLAG_HOLD past its cut. A read never flagged gets no hold."""
    rc, me = st["recruiting"], st["team"]
    cuts = recruiting.flag_cuts(rc)
    hold = recruiting.FLAG_HOLD
    tight = lambda mean: {"looks": recruiting.FIND_LOOKS - 1, "by": {"95": recruiting.FIND_LOOKS - 1},
                          "g": {g: [mean, 1000.0] for g in recruiting.GROUPS}}      # a read this sure has no width
    in_view = lambda pid: {f["flag"] for f in prospects.scouting_view(st)["flags"] if f["pid"] == pid}

    # a gem: the look that completes the set gains him; a look that moves the low end a little under the cut keeps him
    two = next(pid for pid, p in rc["prospects"].items() if p["stars"] == 2 and p["rank"] > recruiting.GEM_RANK
               and not rc["status"][pid]["signed"] and rc["status"][pid]["committed"] != me)
    gem_cut = cuts[2][0]
    rc["reads"][two] = tight(gem_cut + 0.5)
    assert prospects.find(st, two) is None, "a find needs FIND_LOOKS looks"
    entry = recruiting.look(st, two, 95, random.Random(1))
    assert entry["flags"] == ["gem"] and rc["reads"][two]["find"] == "gem", entry
    assert in_view(two) == {"gem"}
    rc["reads"][two]["g"]["potential"] = [gem_cut - hold / 2, 1000.0]
    assert prospects.find(st, two) == "gem", "a read that slipped a little under the cut still holds the flag"
    entry = recruiting.look(st, two, 95, random.Random(2))
    assert entry["flags"] == [] and rc["reads"][two]["find"] == "gem", entry
    assert in_view(two) == {"gem"}
    rc["reads"][two]["g"]["potential"] = [gem_cut - hold - 1.0, 1000.0]
    assert prospects.find(st, two) is None, "a read clearly past the cut releases the flag"
    recruiting.look(st, two, 95, random.Random(3))
    assert rc["reads"][two]["find"] is None and in_view(two) == set()
    rc["reads"][two]["g"]["potential"] = [gem_cut - hold / 2, 1000.0]
    assert prospects.find(st, two) is None, "the hold is for a flag found, not for a read that never crossed the cut"

    # a bust risk: the cut sits near the Weak/Fair line, so a small move is a grade word; the flag holds through it
    four = next(pid for pid, p in rc["prospects"].items() if p["stars"] == 4
                and not rc["status"][pid]["signed"] and rc["status"][pid]["committed"] != me)
    bust_cut = cuts[4][1]
    rc["reads"][four] = tight(bust_cut - 0.5)
    entry = recruiting.look(st, four, 95, random.Random(4))
    assert entry["flags"] == ["bust"] and rc["reads"][four]["find"] == "bust", entry
    before = recruiting.grade_range(st, four, "potential")
    rc["reads"][four]["g"]["potential"] = [bust_cut + hold / 2, 1000.0]
    after = recruiting.grade_range(st, four, "potential")
    assert prospects.find(st, four) == "bust", (before, after)
    entry = recruiting.look(st, four, 95, random.Random(5))
    assert entry["flags"] == [] and rc["reads"][four]["find"] == "bust" and in_view(four) == {"bust"}, entry
    rc["reads"][four]["g"]["potential"] = [bust_cut + hold + 1.0, 1000.0]
    assert prospects.find(st, four) is None
    print(f"   flicker ok: gem cut {gem_cut}, bust cut {bust_cut}, a move of {hold / 2} holds ({before} -> {after}), of {hold + 1} releases")


if __name__ == "__main__":
    for team, seed in SEEDS:
        st = season.new_season(team, "full", seed=seed, career=True)
        rc = st["recruiting"]
        # the generator: potential varies nearly as much within a tier as across them, which is why the cuts are per tier
        share = {s: sum(1 for p in rc["prospects"].values() if p["stars"] == s and p["truth"]["potential"] >= 80)
                 / sum(1 for p in rc["prospects"].values() if p["stars"] == s) for s in (2, 3, 4, 5)}
        assert share[2] > 0.1 and share[3] > 0.1, share
        cuts = recruiting.flag_cuts(rc)
        assert set(cuts) == {2, 3, 4, 5} and all(g > b for g, b in cuts.values()), cuts
        assert cuts[2][0] == truth_cut(rc, 2, recruiting.GEM_PERCENTILE) and cuts[4][1] == truth_cut(rc, 4, recruiting.BUST_PERCENTILE)
        assert recruiting.flag_cuts(rc) is cuts, "the cuts are computed once per class"
        complete_reports(st)
        r = rates(st)
        print(f"{team} seed {seed}: {r['looked']} complete reports ({recruiting.FIND_LOOKS} looks); gems {r['gems']} ({r['gem_rate']:.1%}),"
              f" precision {r['precision']:.2f}; bust risks {r['busts']} of {r['high']} four- and five-stars ({r['bust_rate']:.1%})")
        assert BAND[0] <= r["gem_rate"] <= BAND[1], r
        assert BAND[0] <= r["bust_rate"] <= BAND[1], r
        assert r["precision"] >= PRECISION, r
        assert r["high_star_gems"] == 0, "a gem is a three-star or less"
        assert all(f["flag"] in ("gem", "bust", "generational") for f in prospects.scouting_view(st)["flags"])
        check_flicker(st)
    print("flags ok")
