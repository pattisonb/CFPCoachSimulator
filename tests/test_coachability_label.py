"""Your players show their Coachability, not EA's development trait (season.development_reads): every
generated player carries a placeholder "Normal" trait, so by a career's fourth year a roster read
"Normal Development" from top to bottom. The player page and the depth chart now show each of your
own players' true coachability in the game's own six words (recruits.COACHABILITY, the words the
scouting reads use) and his potential in the scouting report's Potential words; nobody else's roster
shows either (a future portal entrant's coachability stays a read). After an offseason the roster
still reads several words, and the league's mix stays at the levels' shares. (Run as a file: multiprocessing on Windows.)"""
import collections
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from coach_career import offseason, recruiting, recruits   # noqa: E402
from sim import season   # noqa: E402
from test_offseason import finished   # noqa: E402

LEVELS = [n for n, _, _ in recruits.COACHABILITY]
SHARES = {n: s for n, _, s in recruits.COACHABILITY}
TEAM = "ohio-state"
LEAKS = re.compile(r"\b(undefined|null|NaN)\b")
OLD = re.compile(r"Normal Dev|Development: Normal|Normal Development|\b(Impact|Star|Elite) Dev(elopment)?\b")
SHOWN = re.compile(r"Coachability:?\s*(" + "|".join(re.escape(w) for w in LEVELS) + r")")


def check_reads(st: dict, label: str) -> collections.Counter:
    """Your roster: every player has a level from the scale and a Potential word; anyone else's: nothing."""
    reads = season.development_reads(st, TEAM)
    roster = season.load_teams()[TEAM]
    slugs = [p["slug"] for p in roster["offense"] + roster["defense"]]
    assert len(reads) >= 0.9 * len(slugs), (label, len(reads), len(slugs))
    for slug, r in reads.items():
        assert r["coachability"] in LEVELS and r["coach_level"] == LEVELS.index(r["coachability"]) + 1, (label, slug, r)
        from coach_career import clear
        pw = r.get("potential_word")
        assert (pw is not None and pw.isdigit() and 1 <= int(pw) <= 99) if clear.on() else pw in recruiting.WORDS, (label, slug, r)   # Clear Mode: the number
    other = "michigan"
    assert season.development_reads(st, other) == {}, "another team's coachability leaked"
    them = season.load_teams()[other]
    q = (them["offense"] + them["defense"])[0]
    prof = season.player_profile(st, other, slug=q["slug"])
    assert "coachability" not in prof and "potential_word" not in prof, "another team's player page leaked his coachability"
    chart = season.depth_chart_view(st, other)
    assert not any("coachability" in p for u in chart["units"] for r in u["rows"] for p in r["players"])
    # yours: the player page, the chart's cards and the position list carry it; the old trait is not sent to the chart
    mine = season.depth_chart_view(st, TEAM)
    cards = [p for u in mine["units"] for r in u["rows"] for p in r["players"]]
    assert all(p.get("coachability") in LEVELS for p in cards if p["slug"] in reads), label
    assert not any("dev_trait" in p for p in cards), "the depth chart still sends the development trait"
    cand = season.position_candidates(st, TEAM, "QB")["players"]
    assert all(p.get("coachability") in LEVELS for p in cand if p["slug"] in reads) and not any("dev_trait" in p for p in cand)
    slug = next(iter(reads))
    prof = season.player_profile(st, TEAM, slug=slug)
    assert prof["coachability"] == reads[slug]["coachability"] and prof["potential_word"] == reads[slug]["potential_word"]
    words = collections.Counter(r["coachability"] for r in reads.values())
    assert len(words) >= 3, (label, words)
    return words


def check_league_mix(st: dict) -> dict:
    """The whole league after offseasons: every level present, each near its share (recruits.COACHABILITY)."""
    lg = st["league"]
    c = collections.Counter(p.get("c") for t in lg["teams"].values() for p in t["roster"])
    n = sum(c.values())
    assert set(c) <= set(LEVELS), c
    for name, share in SHARES.items():
        assert abs(c[name] / n - share) <= max(0.04, share * 0.5), (name, c[name] / n, share)
    fresh = collections.Counter(p.get("c") for t in lg["teams"].values() for p in t["roster"] if p.get("cls") == "FR")
    assert len(fresh) == len(LEVELS), f"the signed freshmen do not span the scale: {fresh}"
    return {k: round(v / n, 3) for k, v in c.most_common()}


if __name__ == "__main__":
    from coach_career import league
    fresh = season.new_season(TEAM, "full", seed=31, career=True)
    first = check_reads(fresh, "2026")
    st = season.new_season(TEAM, "full", seed=32, career=True)
    sid = st["id"]
    for _ in range(2):                       # two offseasons: real players leave, generated ones arrive
        finished(st)
        offseason.run_all(st)
        st = offseason.next_season(st)
    later = check_reads(st, "2028")
    mix = check_league_mix(st)
    for y in range(2026, 2031):
        p = league.path(sid, y)
        if p.exists():
            p.unlink()
    league.forget(sid)
    season.use_league(None)
    season.close_pool()
    print(f"coachability label ok: 2026 roster {dict(first)}; 2028 roster {dict(later)}; league {mix}")
