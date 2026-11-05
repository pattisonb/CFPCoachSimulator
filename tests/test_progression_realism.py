"""Player progression over a career keeps each position's senior class where the real 2026 rosters'
was (offseason.develop, recruits.seed_real_players): one season played for real (production and
honors feed development) and two faked, then each position's seniors at the end of the second and
third seasons against the real 2026 seniors: the mean, the 90th percentile and how many are rated 85
or better. Before DEV_TOP and the real players' room at their own pace, the real top juniors (fast
learners with big rooms) gained 15-20 points in an offseason and a career's 2027 seniors had about
125 players rated 85+ where the real 2026 seniors had 25. `python3 tests/test_progression_realism.py`"""
import collections
import statistics as st
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from coach_career import league as lg   # noqa: E402
from coach_career import offseason   # noqa: E402
from sim import season   # noqa: E402
from test_offseason import finished   # noqa: E402

SENIORS = ("SR", "SRRS")
ELITE = 85
MEAN_TOL = 6.0          # a position's senior mean within this of the real seniors' (card overall points)
P90_TOL = 9             # ... its 90th percentile within this
ELITE_TOL = (2.5, 6)    # ... its 85+ seniors at most this times the real count plus this
ELITE_TOTAL = 2.0       # ... and all positions' 85+ seniors at most this times the real total


def seniors(lgd: dict) -> dict[str, list[int]]:
    out: dict[str, list[int]] = collections.defaultdict(list)
    for t in lgd["teams"].values():
        for p in t["roster"]:
            if p["cls"] in SENIORS:
                out[offseason.DRAFT_GROUP[p["pos"]]].append(p["o"])
    return out


def p90(v: list[int]) -> int:
    v = sorted(v)
    return v[int(0.9 * (len(v) - 1))]


def table(by: dict[str, list[int]]) -> dict[str, tuple[float, int, int]]:
    return {g: (st.mean(v), p90(v), sum(1 for x in v if x >= ELITE)) for g, v in by.items() if v}


def compare(real: dict, sim: dict, year: int) -> list[str]:
    bad = []
    for g, (mean, top, elite) in real.items():
        if g in ("K", "P"):
            continue
        m, t, e = sim[g]
        if abs(m - mean) > MEAN_TOL:
            bad.append(f"{year} {g} mean {m:.1f} vs real {mean:.1f}")
        if abs(t - top) > P90_TOL:
            bad.append(f"{year} {g} 90th percentile {t} vs real {top}")
        if e > ELITE_TOL[0] * elite + ELITE_TOL[1]:
            bad.append(f"{year} {g} {e} seniors 85+ vs real {elite}")
    total_real = sum(e for g, (_, _, e) in real.items() if g not in ("K", "P"))
    total = sum(e for g, (_, _, e) in sim.items() if g not in ("K", "P"))
    if total > ELITE_TOTAL * total_real:
        bad.append(f"{year} {total} seniors 85+ in all vs real {total_real}")
    return bad


def main() -> None:
    real = table(seniors(lg.from_base()))                    # the real 2026 rosters
    st_ = season.new_season("ohio-state", "full", seed=21, career=True)
    st_["career"]["settings"]["auto_recruit"] = "season"
    season.advance_to(st_, season.FINAL_WEEK)                   # a real season: its production and honors feed development
    rows, bad = [], []
    for i in range(2):
        offseason.run_all(st_)
        st_ = offseason.next_season(st_)
        finished(st_)                                           # the next season faked (scores and classes only)
        year = season.season_year(st_)
        sim = table(seniors(st_["league"]))
        rows.append((year, sim))
        bad += compare(real, sim, year)
    lg.forget(st_["id"])
    season.close_pool()
    for year, sim in rows:
        print(f"seniors {year} (real 2026 in brackets): " + "  ".join(
            f"{g} {sim[g][0]:.0f}/{sim[g][1]}/{sim[g][2]} ({real[g][0]:.0f}/{real[g][1]}/{real[g][2]})" for g in real))
    assert not bad, bad
    print("progression realism ok: each position's seniors stay near the real 2026 seniors (mean, 90th percentile, 85+)")


if __name__ == "__main__":
    main()
