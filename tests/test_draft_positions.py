"""The draft's first round by position (offseason.draft_scores): a prospect is graded against this
year's draft-eligible players at his position (draft_grades), then valued by the NFL's positional
value (DRAFT_VALUE, DRAFT_SHIFT), so the first round spreads over the positions the way the real
ones do, in a career's first offseason and in later ones, and a position whose overalls drift up
cannot take the round over (a played career's 2028 offseason had 24 quarterbacks and receivers in
32 picks). Who declares early is by projected pick, so linemen and defensive backs with the grades go too.
`python3 tests/test_draft_positions.py`"""
import collections
import copy
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from coach_career import league as lg   # noqa: E402
from coach_career import offseason   # noqa: E402
from sim import season   # noqa: E402
from test_offseason import finished   # noqa: E402

ELIGIBLE = {"SR", "SRRS"} | offseason.UNDERCLASS_ELIGIBLE


def pool_of(lgd: dict) -> dict:
    """A league's draft-eligible players only (what the draft reads)."""
    return {"teams": {slug: {"roster": [copy.deepcopy(p) for p in t["roster"] if p["cls"] in ELIGIBLE]} for slug, t in lgd["teams"].items()}}


def career_pools(seed: int, seasons: int) -> list[dict]:
    """The draft pools of a career's first `seasons` offseasons (seasons faked: tests/test_offseason.finished)."""
    out = []
    st = season.new_season("ohio-state", "full", seed=seed, career=True)
    for i in range(seasons):
        finished(st)
        out.append(pool_of(st.get("league") or lg.from_base(season.season_year(st) + 1)))
        if i < seasons - 1:
            offseason.run_all(st)
            st = offseason.next_season(st)
    lg.forget(st["id"])
    return out


def first_round(pool: dict, rng: random.Random) -> tuple[collections.Counter, dict, dict, set]:
    declared, drafted = offseason.draft_board(pool, rng)
    by_id = {p["id"]: p for t in pool["teams"].values() for p in t["roster"]}
    r1 = collections.Counter(offseason.DRAFT_GROUP[by_id[i]["pos"]] for i, pick in drafted.items() if pick <= 32)
    return r1, drafted, by_id, declared


def check_round(r1: collections.Counter, where: str) -> None:
    assert r1["QB"] <= 5 and r1["WR"] <= 7, (where, dict(r1))
    assert r1["QB"] + r1["WR"] <= 11, ("quarterbacks and receivers take the round", where, dict(r1))
    assert r1["EDGE"] >= 2 and r1["OT"] >= 2 and r1["CB"] >= 2, (where, dict(r1))
    assert r1["DL"] >= 1, (where, dict(r1))
    assert not r1["K"] and not r1["P"], ("a specialist in round one", where, dict(r1))
    assert sum(r1.values()) == 32 and len(r1) >= 7, (where, dict(r1))


def top_pick(drafted: dict, by_id: dict, where: str) -> None:
    """The first pick is a top-graded player: one of the two best at his position, rated 80 or better,
    in the top 2% of the draft-eligible players (a year's best quarterback can go first over a 99 at
    a position the NFL values less, as the real drafts do)."""
    first = min(drafted, key=drafted.get)
    p = by_id[first]
    group = offseason.DRAFT_GROUP[p["pos"]]
    same = sorted((q["o"] for q in by_id.values() if offseason.DRAFT_GROUP[q["pos"]] == group), reverse=True)
    everyone = sorted((q["o"] for q in by_id.values()), reverse=True)
    assert p["o"] >= same[1], ("the first pick is not among his position's best two", where, p["pos"], p["o"], same[:5])
    assert p["o"] >= 80 and p["o"] >= everyone[len(everyone) // 50], ("the first pick is not a top player", where, p["o"], everyone[:5])
    assert group not in ("K", "P", "RB", "S", "IOL", "TE"), ("the first pick at a position the NFL takes later", where, p["pos"])


def drift() -> None:
    """Quarterbacks' and receivers' overalls up 10 across the pool (development drifting): the round barely moves."""
    base = lg.from_base(2027)
    pool = pool_of(base)
    r_before, _, _, _ = first_round(pool, random.Random("drift"))
    for t in pool["teams"].values():
        for p in t["roster"]:
            if p["pos"] in ("QB", "WR"):
                p["o"] = min(99, p["o"] + 10)
    r_after, _, _, _ = first_round(pool, random.Random("drift"))
    check_round(r_after, "drifted")
    assert r_after["QB"] + r_after["WR"] <= r_before["QB"] + r_before["WR"] + 2, (dict(r_before), dict(r_after))


def declares() -> None:
    """Early entrants come from every side of the ball: linemen and defensive backs with the grades declare."""
    base = lg.from_base(2027)
    counts = collections.Counter()
    for seed in range(4):
        _, drafted, by_id, declared = first_round(pool_of(base), random.Random(f"declare-{seed}"))
        for i in declared:
            if drafted.get(i, 999) <= 64:
                counts[offseason.DRAFT_GROUP[by_id[i]["pos"]]] += 1
    for g in ("OT", "EDGE", "DL", "CB"):
        assert counts[g] >= 2, ("no early entrants in the first two rounds at", g, dict(counts))
    assert counts["QB"] + counts["WR"] <= 0.45 * sum(counts.values()), dict(counts)


def main() -> None:
    from coach_career import league as _lg   # noqa: F401
    pools = career_pools(5, 3) + career_pools(9, 3)[1:]
    totals = collections.Counter()
    rounds = 0
    for i, pool in enumerate(pools):
        for rep in range(2):
            r1, drafted, by_id, _ = first_round(pool, random.Random(f"positions-{i}-{rep}"))
            check_round(r1, f"pool {i} draw {rep}")
            top_pick(drafted, by_id, f"pool {i} draw {rep}")
            totals += r1
            rounds += 1
    avg = {g: round(n / rounds, 1) for g, n in sorted(totals.items())}
    # on average the real 2021-2025 drafts' shape: QB 2-5, WR 3-6, OT 3-6, EDGE 3-6, CB 3-6
    for g, (lo, hi) in {"QB": (1.5, 5), "WR": (3, 7), "OT": (3, 7), "EDGE": (3, 7), "DL": (1, 4), "CB": (2.5, 6)}.items():
        assert lo <= avg.get(g, 0) <= hi, (g, avg)
    drift()
    declares()
    season.close_pool()
    print(f"draft positions ok: round one over {rounds} drafts {avg}")


if __name__ == "__main__":
    main()
