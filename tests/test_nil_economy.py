"""The NIL economy (recruiting.py, offseason.py): the portal runs on this season's money. Each
school's portal pool is what it had left of the year's budget plus a performance reward, never
less than the collective's portal fund (30% of the budget); keeping players home spends from that
pool; what is unspent after the portal carries into next year's budget, capped by the program's
tier, and applies once. Old saves without the pool open the offseason and the portal. (Run as a
file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import copy
import json

from coach_career import offseason, programs, prospects, recruiting
from sim import season
from test_offseason import finished

five = recruiting._five


def facts(**kw) -> dict:
    f = {"wins": 7, "losses": 5, "conference": False, "playoff": False, "title": False, "met": False}
    f.update(kw)
    return f


if __name__ == "__main__":
    # ----- the reward table: each line alone, the nine-win line replacing the winning one, the cap
    B = 200
    assert recruiting.reward(B, facts(wins=5, losses=7)) == 0
    assert recruiting.reward(B, facts(wins=7, losses=5)) == 20                    # winning record 10%
    assert recruiting.reward(B, facts(wins=9, losses=3)) == 40                    # nine wins 20%, not 30%
    assert recruiting.reward(B, facts(wins=7, losses=5, conference=True)) == 40   # +10%
    assert recruiting.reward(B, facts(wins=7, losses=5, playoff=True)) == 40      # +10%
    assert recruiting.reward(B, facts(wins=7, losses=5, title=True)) == 50        # +15%
    assert recruiting.reward(B, facts(wins=7, losses=5, met=True)) == 40          # +10%
    assert recruiting.reward(B, facts(wins=5, losses=7, met=True)) == 20          # a losing team keeps the lines that apply
    assert recruiting.reward(B, facts(wins=14, losses=1, conference=True, playoff=True, title=True, met=True)) == 100   # 65% capped at 50%
    assert recruiting.reward(135, facts(wins=7, losses=5)) == five(13.5)          # rounded to fives
    why = recruiting.reward_why(facts(wins=9, losses=3, conference=True, met=True))
    assert len(why) == 3 and all(isinstance(w, str) and w for w in why), why
    assert recruiting.reward_why(facts(wins=5, losses=7)) == []
    assert recruiting.REWARD_CAP == 0.5 and recruiting.PORTAL_FLOOR == 0.3
    assert recruiting.CARRY_CAP == {1: 0.15, 2: 0.20, 3: 0.25, 4: 0.30, 5: 0.30}

    # ----- the offseason seeds every school's pool
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    me = st["team"]
    finished(st)
    teams = list(st["recruiting"]["nil"])[:3]
    base = {s: recruiting.nil_budget(st, s) for s in list(season.load_teams())}
    # a school that spent everything on its class and lost enters the portal with exactly the floor
    sf = offseason.season_facts(st)
    loser = next(s for s in base if s != me and sf[s]["wins"] < sf[s]["losses"] and not any(sf[s][k] for k in ("conference", "playoff", "title", "met")))
    st["recruiting"]["nil"][loser] = {"budget": 0, "held": {}}
    pp = recruiting.portal_pool(st, loser, facts(wins=3, losses=9))
    assert pp["left"] == 0 and pp["reward"] == 0 and pp["floor"] == five(0.3 * base[loser]) and pp["pool"] == pp["floor"], pp
    off = offseason.start(st)
    pools = st["nil_pool"]
    assert set(pools) == set(st["league"]["teams"]), "every school has a pool"
    for s, p in pools.items():
        for k in ("left", "reward", "reward_why", "floor", "pool", "retained", "record"):
            assert k in p, (s, k)
        assert p["floor"] == five(recruiting.PORTAL_FLOOR * base[s]) and p["pool"] >= p["floor"]
        assert p["pool"] == max(p["floor"], p["left"] + p["reward"]) and p["pool"] % 5 == 0 and p["retained"] == 0
        assert 0 <= p["reward"] <= five(recruiting.REWARD_CAP * base[s])
    assert pools[loser]["pool"] == pools[loser]["floor"] and pools[loser]["reward"] == 0
    # the review carries the pool's math for your school (the page shows it)
    rv = offseason.view(st)["review"]
    assert rv["nil_portal"] == pools[me], rv.get("nil_portal")
    assert pools[me]["reward"] == recruiting.reward(base[me], facts(wins=rv["record"][0], losses=rv["record"][1],
                                                                        conference=offseason.season_facts(st)[me]["conference"],
                                                                        playoff=offseason.season_facts(st)[me]["playoff"],
                                                                        title=st["champion"] == me, met=rv["met"]))
    # the class budget no longer carries a retention deduction: nil_budget is the tier's number
    assert recruiting.nil_budget(st, me) == max(recruiting.NIL_FLOOR, five(recruiting.NIL_PER_TIER * programs.get(st, me)["nil"]))

    # ----- keep them home spends from the pool; an ask past it is refused, never negative
    offseason.advance(st)
    assert off["stage"] == "retention"
    pool_me = pools[me]["pool"]
    view = offseason.view(st)["retention"]
    assert view["budget"] == pool_me and view["left"] == pool_me, view["budget"]
    p0 = next(e for e in off["retention"]["players"] if e["intent"] == "portal")
    offseason.retain(st, p0["id"], "meet")
    try:
        offseason.retain(st, p0["id"], "nil", nil=pool_me + 5)
        raise AssertionError("NIL past the pool was taken")
    except offseason.RetentionError as ex:
        assert ex.code == 400 and "not enough NIL" in str(ex), (ex.code, str(ex))
    try:
        offseason.retain(st, p0["id"], "nil", nil=-5)
        raise AssertionError("negative NIL was taken")
    except offseason.RetentionError as ex:
        assert ex.code == 400
    offer = min(pool_me, max(5, p0["ask"]["nil"]))
    offseason.retain(st, p0["id"], "nil", nil=offer)
    assert offseason.view(st)["retention"]["left"] == pool_me - offer
    offseason.advance(st)
    assert off["stage"] == "portal_w1"
    stayed = next(r for r in off["retention"]["results"] if r["id"] == p0["id"])["status"] == "stayed"
    assert pools[me]["retained"] == (offer if stayed else 0) and off["retention"]["spent"] == pools[me]["retained"]
    # the portal's budget is the pool less what retention spent, for you and the AI alike
    assert recruiting.is_portal(st)
    n_me = recruiting._nil(st, me)
    assert n_me["budget"] == pool_me - pools[me]["retained"] >= 0 and n_me["held"] == {}
    for s in list(pools)[:5]:
        assert recruiting._nil(st, s)["budget"] == pools[s]["pool"] - pools[s]["retained"], s
    rvw = prospects.recruiting_view(st)
    assert rvw["nil"]["pool"] == n_me["budget"] == rvw["nil"]["budget"] and rvw["nil"]["carry"] is None, rvw["nil"]

    # ----- the carry after the portal: min(unspent, cap × next year's budget), by tier
    while off["stage"] != "portal_w4":
        offseason.advance(st)
    tiers = {s: programs.get(st, s)["tier"] for s in pools}
    t1 = next(s for s in pools if tiers[s] == 1 and s != me)
    t5 = next(s for s in pools if tiers[s] == 5)
    small = next(s for s in pools if s not in (t1, t5, me))
    for s in (t1, t5):                                  # a champion's pool, nothing spent: the cap holds
        recruiting._nil(st, s).update(budget=10000, held={})
    recruiting._nil(st, small).update(budget=5, held={})
    offseason.advance(st)
    assert off["stage"] == "development"
    carry = st["nil_carry"]
    assert set(carry) == set(pools)
    for s, c in carry.items():
        cap = five(recruiting.CARRY_CAP[tiers[s]] * recruiting.nil_budget(st, s))
        assert c == max(0, min(5 * (pools[s]["unspent"] // 5), cap)) and c % 5 == 0, (s, c, pools[s])
    assert carry[t1] == five(0.15 * recruiting.nil_budget(st, t1)) < 10000
    assert carry[t5] == five(0.30 * recruiting.nil_budget(st, t5)) < 10000
    assert carry[small] == 5 and pools[small]["unspent"] == 5
    assert pools[t1]["carry"] == carry[t1]
    assert "spent" in off["portal_nil"] and "signed" in off["portal_nil"] and "ai_spent" in off["portal_nil"]
    # the class block is back, with the class's own records (not the portal's)
    assert not recruiting.is_portal(st) and recruiting._nil(st, t1)["budget"] != 10000

    # ----- the carry applies once; a save reloaded mid-offseason does not double it
    saved = json.loads(json.dumps(st))
    for s_ in (st, saved):
        while s_["offseason"]["stage"] != "ready":
            offseason.advance(s_)
    new = offseason.next_season(st)
    new2 = offseason.next_season(saved)
    assert "nil_pool" not in new and new["nil_carry"] == carry
    for s in (t1, t5, small):
        B_next = recruiting.nil_budget(new, s)
        rec = recruiting._nil(new, s)
        assert rec["budget"] == B_next + carry[s] and rec["carry"] == carry[s], (s, rec, B_next, carry[s])
        assert recruiting._nil(new, s)["budget"] == B_next + carry[s], "applied twice"
        assert s not in new["nil_carry"], "the carry was not cleared when it was consumed"
        assert recruiting._nil(new2, s)["budget"] == B_next + carry[s], "the reloaded save differs"
    assert recruiting.nil_left(new, t1) == recruiting.nil_budget(new, t1) + carry[t1]
    v = prospects.recruiting_view(new)
    assert v["nil"]["carry"] == carry[me] and v["nil"]["pool"] is None and v["nil"]["base"] == recruiting.nil_budget(new, me)
    assert v["nil"]["budget"] == recruiting.nil_budget(new, me) + carry[me]

    # ----- old saves: no nil_pool at the retention step, none at the portal
    st2 = season.new_season("ohio-state", "full", seed=6, career=True)
    finished(st2)
    off2 = offseason.start(st2)
    offseason.advance(st2)
    st2.pop("nil_pool")
    st2.pop("nil_carry", None)
    assert offseason.view(st2)["retention"]["budget"] > 0
    assert st2["nil_pool"][me]["pool"] >= st2["nil_pool"][me]["floor"]
    offseason.advance(st2)
    assert off2["stage"] == "portal_w1" and recruiting._nil(st2, me)["budget"] > 0
    st2.pop("nil_pool")
    st2["recruiting"]["nil"] = {}
    b = recruiting._nil(st2, "akron")["budget"]
    assert b == st2["nil_pool"]["akron"]["pool"] - st2["nil_pool"]["akron"]["retained"] > 0
    assert offseason.view(st2)["review"]["nil_portal"]["pool"] == st2["nil_pool"][me]["pool"]
    offseason.run_all(st2)
    new3 = offseason.next_season(st2)
    assert recruiting._nil(new3, me)["budget"] >= recruiting.nil_budget(new3, me)
    season.close_pool()
    print("ok")
