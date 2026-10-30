"""Position-change projections respect size and position skills (coach_career/position_fit.py):
a 197-pound free safety no longer projects 67 at guard. His ratings go onto the new group's scale,
the skills he has never used are discounted, his build is charged against the spot's, his own
position stays exact; both call sites (offseason.position_options, season.position_options) use
it, change_position writes the transferred ratings and moving back the same season restores them."""
import json
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import league as lg, offseason, position_fit as pf
from sim import season
from teamdata import game_scale as gs
from test_offseason import finished

OL = ("LT", "LG", "C", "RG", "RT")
EDGE = ("LEDG", "REDG")


def real_player(role: str, height_in: int, weight: int, lo: int, hi: int) -> dict:
    """The real player nearest a build at a position, rated in a band."""
    teams = json.loads(pf.ENGINE_FILE.read_text(encoding="utf-8"))["teams"]
    pool = [p for t in teams.values() for p in t["offense"] + t["defense"]
            if p.get("role") == role and p.get("skills") and lo <= p["ovr"] <= hi and p.get("height_in") and p.get("weight")]
    return min(pool, key=lambda p: abs(p["height_in"] - height_in) * 5 + abs(p["weight"] - weight))


def table(p: dict) -> dict[str, int]:
    attrs = dict(zip(gs.keys(), p["skills"]))
    return {pos: pf.project(attrs, p["height_in"], p["weight"], p["role"], pos) for pos in lg.GROUP_OF if pos not in ("K", "P")}


def sanity() -> None:
    sizes = pf.sizes()
    assert 300 < sizes["LG"][1][0] < 320 and 185 < sizes["FS"][1][0] < 200, "the real builds were read"
    # the screenshot's safety: 6'1" 197, about 49 overall
    fs = real_player("FS", 73, 197, 45, 52)
    t, own = table(fs), fs["ovr"]
    assert t["FS"] == own == gs.overall(dict(zip(gs.keys(), fs["skills"])), "FS"), "his own position is exact"
    assert all(20 <= t[pos] <= 39 for pos in OL), {pos: t[pos] for pos in OL}
    assert 25 <= t["TE"] <= 49 and 25 <= t["QB"] <= 39, (t["TE"], t["QB"])
    assert abs(t["SS"] - own) <= 8 and abs(t["CB"] - own) <= 14, (t["SS"], t["CB"], own)
    assert t["LG"] < t["SS"] and t["LG"] < t["CB"], "a safety is a better corner than a guard"
    # a 6'5" 300 DT: his skills discounted, his size fine, so the line is a reasonable band
    dt = real_player("DT", 77, 300, 50, 65)
    t, own = table(dt), dt["ovr"]
    assert all(own - 28 <= t[pos] <= own - 8 for pos in OL), ({pos: t[pos] for pos in OL}, own)
    assert all(own - 18 <= t[pos] <= own for pos in EDGE), ({pos: t[pos] for pos in EDGE}, own)
    assert t["CB"] <= 25 and t["WR"] <= 30, "a 300-pound tackle is no corner"
    # a 6'3" 240 linebacker to the edge: close to his number
    lb = real_player("MIKE", 75, 240, 48, 60)
    t, own = table(lb), lb["ovr"]
    assert all(abs(t[pos] - own) <= 6 for pos in EDGE), ({pos: t[pos] for pos in EDGE}, own)
    assert all(abs(t[pos] - own) <= 3 for pos in ("SAM", "WILL")), "the other linebacker spots share his skills"
    # a receiver to corner: a middling discount
    wr = real_player("WR", 73, 190, 52, 60)
    t, own = table(wr), wr["ovr"]
    assert own - 22 <= t["CB"] <= own - 6, (t["CB"], own)
    assert all(t[pos] <= 30 for pos in OL), "a 190-pound receiver is no lineman"
    # size alone: the same ratings, a 230-pound back loses a little (a speed spot), a 150-pound back a lot
    hb = real_player("HB", 71, 215, 50, 60)
    attrs = dict(zip(gs.keys(), hb["skills"]))
    assert 0 < pf.size_penalty(71, 230, "HB") <= pf.SIZE_PENALTY and pf.size_penalty(71, 150, "HB") > 12
    assert pf.size_penalty(76, 340, "LG") < pf.size_penalty(76, 280, "LG"), "heavy costs a lineman less than light"
    assert pf.project(attrs, 71, 230, "HB", "FB") >= pf.project(attrs, 71, 190, "HB", "FB") + 5
    assert pf.size_penalty(None, None, "LG") == 0 and pf.project(attrs, 71, 215, "HB", "HB") == hb["ovr"]
    # transfers: within the group every skill stays; across units the floor holds a raw athlete up
    same = pf.transfer(attrs, "HB", "FB")
    assert all(same[k] == attrs[k] for k in attrs), "a back's skills go whole to fullback"
    near, far = pf.transfer(attrs, "HB", "LG"), pf.transfer(attrs, "HB", "DT")
    assert all(near[k] >= pf.POSITION_FLOOR["LG"] for k in near if k not in pf.ATHLETIC), "a back's blocking at guard starts from the floor"
    assert all(far[k] >= pf.POSITION_FLOOR["DT"] for k in far if k not in pf.ATHLETIC)
    assert near["speed"] == gs.to_ours(gs.to_base(attrs["speed"], "RB", "speed"), "OL", "speed"), "speed is read against the new group"
    print(f"sanity ok: {fs['name']} FS {fs['ovr']} -> LG {table(fs)['LG']}, TE {table(fs)['TE']}, CB {table(fs)['CB']}; "
          f"{dt['name']} DT {dt['ovr']} -> LG {table(dt)['LG']}; {lb['name']} MIKE {lb['ovr']} -> LEDG {table(lb)['LEDG']}; "
          f"{wr['name']} WR {wr['ovr']} -> CB {table(wr)['CB']}")


def call_sites() -> None:
    st = season.new_season("ohio-state", "full", seed=4, career=True)
    me = st["team"]
    season.advance_to(st, 2)
    team = season.load_teams()[me]
    fs = next(p for p in team["defense"] if p.get("role") == "FS" and p.get("skills") and p.get("weight"))
    old = {pos: gs.overall(season._skills(fs), pos) for pos in lg.GROUP_OF}
    # the season's call site
    opts = season.position_options(st, me, fs["slug"])
    by = {o["pos"]: o["overall"] for o in opts}
    assert opts[0]["pos"] == "FS" and opts[0]["current"] and by["FS"] == fs["ovr"] == old["FS"]
    assert by["LG"] <= 40 and by["LG"] <= old["LG"], (by["LG"], old["LG"])
    assert by["LG"] == pf.project(season._skills(fs), fs["height_in"], fs["weight"], "FS", "LG")
    assert all(by[pos] <= 45 for pos in OL), by
    # the change writes his transferred skills onto him and his overall is the projection
    r = season.change_position(st, me, fs["slug"], "LG")
    assert r["position"] == "LG" and r["overall"] == by["LG"] and r["moved_from"] == "FS", r
    moved = next(p for p in season.team_data(st, me)["offense"] if p["slug"] == fs["slug"])
    ovr, skills = pf.season_move(fs, "FS", "LG")
    assert moved["ovr"] == ovr == by["LG"] and moved["skills"] == skills and moved["skills"] != fs["skills"]
    again = {o["pos"]: o for o in season.position_options(st, me, fs["slug"])}
    assert again["LG"]["current"] and again["LG"]["overall"] == by["LG"] and again["FS"]["overall"] == fs["ovr"], "the options still project from where he began"
    r = season.change_position(st, me, fs["slug"], "FS")
    back = next(p for p in season.team_data(st, me)["defense"] if p["slug"] == fs["slug"])
    assert r["moved_from"] is None and back["skills"] == fs["skills"] and back["ovr"] == fs["ovr"]
    # the offseason's call site
    finished(st)
    offseason.start(st)
    roster = st["league"]["teams"][me]["roster"]
    c = next(x for x in roster if x["pos"] == "FS" and x.get("wt"))
    attrs = st["league"]["attrs"]
    r0, o0 = list(c["r"]), c["o"]
    old = {pos: gs.overall(lg.ratings(c, attrs), pos) for pos in offseason.GROUP}
    opts = {o["pos"]: o for o in offseason.position_options(st, c["id"])}
    assert opts["FS"]["current"] and opts["FS"]["overall"] == o0
    assert opts["LG"]["overall"] <= 40 and opts["LG"]["overall"] <= old["LG"], (opts["LG"]["overall"], old["LG"])
    assert opts["LG"]["overall"] == pf.project(lg.ratings(c, attrs), c["ht"], c["wt"], "FS", "LG")
    offseason.change_position(st, c["id"], "LG")
    assert c["pos"] == "LG" and c["o"] == opts["LG"]["overall"] and c["moved_from"] == "FS" and c["moved_attrs"] == r0
    assert c["r"] != r0 and lg.overall(c, attrs) == gs.overall(pf.transfer(dict(zip(attrs, r0)), "FS", "LG"), "LG"), "his ratings are the transferred ones"
    assert c["r"][attrs.index("run_block")] >= pf.POSITION_FLOOR["LG"]
    # a second move the same offseason starts from where he began; moving back restores him
    offseason.change_position(st, c["id"], "TE")
    assert c["pos"] == "TE" and c["moved_from"] == "FS" and c["o"] == opts["TE"]["overall"]
    offseason.change_position(st, c["id"], "FS")
    assert c["pos"] == "FS" and c["r"] == r0 and c["o"] == o0 and "moved_from" not in c and "moved_attrs" not in c
    # after the offseason the change is his
    offseason.change_position(st, c["id"], "SS")
    pf.settle(roster)
    assert c["pos"] == "SS" and "moved_attrs" not in c and c["moved_from"] == "FS"
    print(f"call sites ok: {fs['name']} FS {fs['ovr']} -> LG {by['LG']} in season (was {old['LG']} by the bare formula); "
          f"{c['n']} FS {o0} -> LG {opts['LG']['overall']} in the offseason")


if __name__ == "__main__":
    sanity()
    call_sites()
