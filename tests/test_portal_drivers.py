"""Why players transfer (offseason._departures, portal_odds): a starter paid under his market at his
program's NIL tier chases a deal; a slipping program (a tier lost this year, a new head coach, a
weak developer after a losing year) loses starters; a rising program keeps its starters. The
pending item carries the driver, so Keep Them Home and the portal recap say the real reason.
(Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import collections

from coach_career import offseason, programs, recruiting
from sim import season
from test_offseason import finished

TOP, LOW = "ohio-state", "purdue"          # both Power 4: no Group of 5 move-up rule in the way
YEAR = 2027
POSITIONS = ["QB", "HB", "WR", "WR", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LEDG", "REDG", "DT", "DT", "SAM", "MIKE", "WILL", "CB", "CB", "FS", "SS"]


def mini_league(tier_top=1, tier_low=5, dev=70, since=2019) -> dict:
    """Two schools of sophomores (no draft, no graduation): a starting lineup of mid-rated players
    and one QB rated like a five-star (the player under test) on each."""
    teams = {}
    for slug, tier in ((TOP, tier_top), (LOW, tier_low)):
        roster = []
        for i, pos in enumerate(POSITIONS):
            roster.append({"id": f"{slug}-{i}", "n": f"Player {i}", "pos": pos, "cls": "SO", "o": 70 if pos == "QB" else 40, "s": 3, "r": []})
        for i, pos in enumerate(POSITIONS, len(POSITIONS)):
            roster.append({"id": f"{slug}-{i}", "n": f"Backup {i}", "pos": pos, "cls": "SO", "o": 30, "s": 2, "r": []})
        teams[slug] = {"roster": roster, "program": {"tier": tier, "nil": 90.0 if tier == 1 else 20.0, "rating": 80.0 if tier == 1 else 20.0},
                       "coaches": {"head_coach": {"name": "Coach", "since": since, "ratings": {"overall": 60, "player_development": dev}}}}
    return {"teams": teams, "attrs": [], "year": YEAR}


def usage_for(lgd: dict) -> dict:
    return {slug: {p["id"]: ("starter" if i < len(POSITIONS) else "bench") for i, p in enumerate(t["roster"])} for slug, t in lgd["teams"].items()}


def mini_state(seed: int, losing=None) -> dict:
    games = {}
    for i in range(6):
        for slug in (losing or []):
            games[f"{slug}-{i}"] = {"home": slug, "away": "rutgers", "played": True, "home_score": 3, "away_score": 24, "week": i + 1,
                                    "kind": "regular", "conference_game": False}
    return {"seed": seed, "id": "drivers", "year": YEAR - 1, "team": "nobody", "games": games, "season_stats": {}}


def entries(n: int, shifts=None, **kw) -> dict:
    """Over n seeded offseasons: how often the test QB of each school enters, and his drivers."""
    out = {TOP: collections.Counter(), LOW: collections.Counter()}
    for seed in range(n):
        lgd = mini_league(**{k: v for k, v in kw.items() if k in ("tier_top", "tier_low", "dev", "since")})
        st = mini_state(seed, losing=kw.get("losing"))
        if kw.get("kept"):
            for t in lgd["teams"].values():
                t["roster"][0]["kept"] = YEAR - 1
        events, entrants, pending = offseason._departures(st, lgd, usage_for(lgd), shifts=shifts or {})
        for slug in (TOP, LOW):
            e = entrants.get(f"{slug}-0")
            if e:
                out[slug][e.get("driver") or "role"] += 1
    return out


if __name__ == "__main__":
    # the market value: a five-star-equivalent QB asks like a five-star; a bench-level player asks nothing
    assert recruiting.market_value("QB", 70) == recruiting.ASK[5] * recruiting.ASK_POS["QB"]
    assert recruiting.market_value("C", 40) == 0
    # 1. NIL: the same QB at a tier-1 program (pay near his market) and at a tier-5 one (far under it)
    n = 300
    r = entries(n)
    top, low = sum(r[TOP].values()), sum(r[LOW].values())
    assert low > 0 and low / max(1, top) > 1.5, (r[TOP], r[LOW])
    assert r[LOW]["deal"] >= 0.6 * low, r[LOW]                       # the shortfall is the story at the low tier
    # the odds themselves: the deal segment is the shortfall's share of his market, NIL_PULL times, capped
    p = {"id": "x", "pos": "QB", "cls": "SO", "o": 70}
    ctx = {"losing": False, "p4": True, "year": YEAR, "tier": 5, "slipping": None, "rising": False}
    odds = dict(offseason.portal_odds(p, "starter", ctx))
    mv = recruiting.market_value("QB", 70)
    assert abs(odds["deal"] - min(offseason.NIL_PULL_CAP, offseason.NIL_PULL * (mv - offseason.NIL_TIER_PAY[5]) / mv)) < 1e-9, odds
    assert dict(offseason.portal_odds(p, "bench", ctx)).get("deal", 0) == 0          # bench players have no market
    # 2. a player kept with NIL last offseason was paid: no deal pull this year
    assert dict(offseason.portal_odds(dict(p, kept=YEAR - 1), "starter", ctx)).get("deal", 0) == 0
    rk = entries(n, kept=True)
    assert rk[LOW]["deal"] == 0 and sum(rk[LOW].values()) < low, (rk[LOW], low)
    # 3. a program that dropped a tier this year loses more starters, for slipping
    same = entries(n, tier_top=3, tier_low=3)
    drop = entries(n, tier_top=3, tier_low=3, shifts={LOW: 1})
    assert sum(drop[LOW].values()) > sum(same[LOW].values()) and drop[LOW]["slipping"] > 0, (same[LOW], drop[LOW])
    assert drop[TOP]["slipping"] == 0
    # 4. a weak developer after a losing year: better_coach
    weak = entries(n, tier_top=3, tier_low=3, dev=35, losing=[LOW])
    assert weak[LOW]["better_coach"] > 0 and weak[TOP]["better_coach"] == 0, (weak[TOP], weak[LOW])
    strong = entries(n, tier_top=3, tier_low=3, dev=70, losing=[LOW])
    assert strong[LOW]["better_coach"] == 0 and sum(weak[LOW].values()) > sum(strong[LOW].values()), (weak[LOW], strong[LOW])
    # a new head coach's first year counts as a change: slipping
    new = entries(n, tier_top=3, tier_low=3, since=YEAR - 1)
    assert new[LOW]["slipping"] > 0 and new[TOP]["slipping"] > 0, (new[TOP], new[LOW])
    # 5. a program that rose a tier keeps its starters (every portal chance halved)
    rose = entries(n, tier_top=3, tier_low=3, shifts={LOW: -1})
    assert sum(rose[LOW].values()) < sum(same[LOW].values()), (same[LOW], rose[LOW])
    seg = dict(offseason.portal_odds(p, "starter", dict(ctx, tier=3, rising=True)))
    seg0 = dict(offseason.portal_odds(p, "starter", dict(ctx, tier=3)))
    assert all(abs(seg[k] - offseason.RISING_STAY * seg0[k]) < 1e-9 for k in seg0), (seg, seg0)
    # 6. the reasons: a pending item's driver decides the text, after the role stories
    assert offseason.REASONS["better_coach"] == "Wants a better coach" and offseason.REASONS["slipping"] == "The program is slipping"
    # the real league: the share stays in band, the drivers show up, your deal leavers ask at least the shortfall
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(st)
    off = offseason.start(st)
    lg = st["league"]
    returning = sum(len(t["roster"]) for t in lg["teams"].values()) + len(off["portal"]["players"])   # as test_offseason counts it
    entrants = off["portal"]["players"]
    drivers = collections.Counter(e.get("driver") or "role" for e in entrants.values())
    assert drivers["deal"] > 0 and (drivers["slipping"] + drivers["better_coach"]) > 0, drivers
    by_tier = collections.Counter(programs.get(st, e["from"])["tier"] for e in entrants.values() if e.get("usage") == "starter")
    teams_by_tier = collections.Counter(t["program"]["tier"] for t in lg["teams"].values())
    per_team = {k: by_tier[k] / teams_by_tier[k] for k in sorted(teams_by_tier)}
    assert per_team[5] > per_team[1], per_team                        # the bottom tier loses more starters a school than the top
    ret = off["retention"]["players"]
    for e in ret:
        assert e["reason_key"] in offseason.REASONS and e["reason"], e
        if e["reason_key"] == "deal" and e.get("shortfall"):
            assert e["ask"]["nil"] >= e["shortfall"], e
    # the retention entries say the driver's story
    from test_portal_reasons import entry, with_cls
    roster = lg["teams"][st["team"]]["roster"]
    qb = max((q for q in roster if q["pos"] == "QB"), key=lambda q: q["o"])
    e = entry(st, with_cls(qb, "JR"), "starter", driver="deal", shortfall=40)
    assert e["reason_key"] == "deal" and e["ask"]["nil"] >= 40, e
    e = entry(st, with_cls(qb, "JR"), "starter", driver="slipping")
    assert e["reason_key"] == "slipping" and e["reason"] == "The program is slipping", e
    e = entry(st, with_cls(qb, "JR"), "starter", driver="better_coach", losing=True, winning=False)
    assert e["reason_key"] == "losing", e                              # the role and record stories come first
    e = entry(st, with_cls(qb, "JR"), "starter", driver="better_coach")
    assert e["reason_key"] == "better_coach" and e["reason"] == "Wants a better coach", e
    # the portal recap's lost rows carry the retention reasons (the new ones among them when they fall)
    reasons = {x["id"]: x["reason"] for x in ret}
    while off["stage"] not in offseason.RECAP_STAGES:
        offseason.advance(st)
    rec = offseason._portal_recap(st)
    assert rec is not None and all(r["reason"] == reasons.get(r["id"]) for r in rec["lost"]), rec["lost"][:3]
    lost_keys = {x["reason_key"] for x in ret if x["id"] in {r["id"] for r in rec["lost"]}}
    assert lost_keys <= set(offseason.REASONS), lost_keys
    share = len(entrants) / returning
    assert 0.06 <= share <= 0.09, share
    print(f"portal drivers ok: league share {share:.1%}; QB entries top {top} low {low} ({dict(r[LOW])}); league drivers {dict(drivers)}; "
          f"starters lost a school by tier {({k: round(v, 2) for k, v in per_team.items()})}; recap lost {len(rec['lost'])} {sorted(lost_keys)}")
    season.close_pool()
